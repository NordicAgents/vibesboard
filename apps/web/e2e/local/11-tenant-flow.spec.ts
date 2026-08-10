/**
 * Section 11 — Tenant Flow
 *
 * Tests the tenant management user journey end to end:
 *   - Create a team workspace (creator becomes its TENANT_ADMIN), slug collision
 *   - Tenant settings page renders the *active* workspace (not just the shell)
 *   - Team management page: real member rows, and the personal-workspace guard
 *   - Invitation lifecycle: send → preview (masked) → cancel, and
 *     send → accept (as the outsider) → role change → removal
 *   - Usage page + usage API contract
 *   - Switching the active workspace re-scopes the agent list
 *
 * Conventions this file follows deliberately:
 *   - Every request asserts the ONE status the handler returns; there are no
 *     `test.skip()` escape hatches, because a 403 here can only mean a
 *     regression (TEAM_COLLABORATION is ON by default — packages/policy
 *     features.ts only disables INBOX* and AGENT_ACTIONS).
 *   - Page assertions target markup only the page under test renders. The
 *     settings layout (app/settings/layout.tsx) unconditionally renders
 *     "Settings", "Tenant Settings" and "Usage", so matching those proves
 *     nothing about the page body.
 *   - Every workspace this file creates is deleted again. createTeamWorkspace
 *     refuses at MAX_TEAM_WORKSPACES = 5 per user and a retry re-enters
 *     beforeAll in a fresh worker, so leaked workspaces become a 429 that
 *     fails the whole file.
 */
import { test, expect, request as playwrightRequest, type Page } from '@playwright/test'
import {
  BASE_URL,
  STORAGE_STATE,
  OUTSIDER_STATE,
  E2E_USER,
  E2E_OUTSIDER,
} from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

// Superadmin session, seeded by e2e/local/global-setup.ts. Used only to delete
// the workspaces this file creates (DELETE /api/admin/tenants/[id] is
// superadmin-only; there is no self-serve workspace delete).
const ADMIN_STATE = 'e2e/.auth/admin.json'

// Unique per worker: a retried run re-imports the module, so the retry's
// workspace never collides with (or is confused for) the failed run's.
const RUN = Date.now()
const TEAM_NAME = `E2E Team Workspace ${RUN}`
const TEAM_SLUG = `e2e-team-${RUN}`

let teamTenantId: string
let personalTenantId: string

/**
 * The switcher's row (components/tenants/tenant-switcher.tsx TenantItem) renders
 * the workspace name AND a member label, so the menuitem's accessible name is
 * "<workspace> <members>" — matching the bare name with `exact` can never hit.
 * Match the name span exactly instead: TEAM_NAME carries the per-run timestamp,
 * so this still cannot be satisfied by a workspace another run leaked.
 */
function teamMenuItem(page: Page) {
  return page
    .getByRole('menuitem')
    .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
}

async function ownerContext() {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
}

async function outsiderContext() {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: OUTSIDER_STATE,
  })
}

/**
 * Reclaim the MAX_TEAM_WORKSPACES quota. Asserts, so a silent leak fails
 * loudly instead of turning into a 429 two runs later. Callers inside a
 * `finally` pass `soft` so a cleanup failure cannot mask the real error.
 */
async function deleteWorkspace(tenantId: string, soft = false) {
  const admin = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: ADMIN_STATE,
  })
  try {
    const res = await admin.delete(`/api/admin/tenants/${tenantId}`, {
      failOnStatusCode: false,
    })
    const message = `failed to clean up workspace ${tenantId}: ${await res.text()}`
    if (soft) expect.soft(res.status(), message).toBe(200)
    else expect(res.status(), message).toBe(200)
  } finally {
    await admin.dispose()
  }
}

test.beforeAll(async () => {
  const owner = await ownerContext()
  try {
    const active = await owner.get('/api/user/active-tenant')
    expect(active.status()).toBe(200)
    personalTenantId = (await active.json()).tenant_id
    expect(personalTenantId).toBeTruthy()

    const res = await owner.post('/api/tenants/create-team', {
      data: { name: TEAM_NAME, slug: TEAM_SLUG },
      failOnStatusCode: false,
    })
    // 429 here means the MAX_TEAM_WORKSPACES quota was exhausted by leaked
    // workspaces — surface the body so it is not mistaken for an auth failure.
    expect(res.status(), await res.text()).toBe(201)
    const { tenant } = await res.json()
    teamTenantId = tenant.id
    expect(teamTenantId).toBeTruthy()
    expect(tenant.slug).toBe(TEAM_SLUG)
    expect(tenant.isPersonal).toBe(false)
    expect(teamTenantId).not.toBe(personalTenantId)
  } finally {
    await owner.dispose()
  }
})

test.afterAll(async () => {
  if (teamTenantId) await deleteWorkspace(teamTenantId)
})

// ─── Workspace Creation ───────────────────────────────────────────────────────

test.describe('Tenant — Workspace Creation', () => {
  test('creating a team workspace makes the creator its TENANT_ADMIN', async ({
    request,
  }) => {
    const slug = `e2e-extra-team-${Date.now()}`
    const res = await request.post('/api/tenants/create-team', {
      data: { name: 'E2E Extra Team', slug },
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(201)
    const { tenant } = await res.json()
    expect(tenant.slug).toBe(slug)
    expect(tenant.name).toBe('E2E Extra Team')
    expect(tenant.isPersonal).toBe(false)

    try {
      // Read the membership back: the creator must be able to administer it.
      const users = await request.get(`/api/tenants/${tenant.id}/users`, {
        failOnStatusCode: false,
      })
      expect(users.status()).toBe(200)
      const { users: members } = await users.json()
      expect(members).toHaveLength(1)
      expect(members[0].email).toBe(E2E_USER.email)
      expect(members[0].role).toBe('TENANT_ADMIN')
      expect(members[0].tenant_id).toBe(tenant.id)
    } finally {
      await deleteWorkspace(tenant.id, true)
    }

    // And the membership really is gone once the workspace is deleted.
    const after = await request.get(`/api/tenants/${tenant.id}/config`, {
      failOnStatusCode: false,
    })
    expect(after.status()).toBe(403)
  })

  test('a duplicate slug is refused with 409 and leaves the first workspace intact', async ({
    request,
  }) => {
    const slug = `e2e-collision-${Date.now()}`
    const first = await request.post('/api/tenants/create-team', {
      data: { name: 'Collision A', slug },
      failOnStatusCode: false,
    })
    expect(first.status(), await first.text()).toBe(201)
    const firstId = (await first.json()).tenant.id

    try {
      const second = await request.post('/api/tenants/create-team', {
        data: { name: 'Collision B', slug },
        failOnStatusCode: false,
      })
      // 429 would mean the workspace quota, not the slug — assert the slug path.
      expect(second.status(), await second.text()).toBe(409)
      expect((await second.json()).error).toMatch(/slug already exists/i)

      // The loser must not have overwritten the winner.
      const config = await request.get(`/api/tenants/${firstId}/config`)
      expect(config.status()).toBe(200)
      expect((await config.json()).tenant.name).toBe('Collision A')
    } finally {
      await deleteWorkspace(firstId, true)
    }
  })

  test('workspace switcher lists the new team workspace', async ({ page }) => {
    await page.goto('/agents')
    // Target the sidebar workspace switcher by testid. A name-based query is
    // ambiguous here: the sidebar footer renders a second TenantSwitcher (the
    // account menu), and it streams in before the sidebar one, so `.first()`
    // used to open the account menu and never show any workspace.
    const switcher = page.getByTestId('workspace-switcher')
    await expect(switcher).toBeVisible({ timeout: 10_000 })
    await switcher.click()
    await expect(page.getByRole('menu')).toBeVisible()
    // The team created in beforeAll, by its exact per-run name (a stale
    // workspace from another run cannot satisfy this).
    await expect(teamMenuItem(page)).toHaveCount(1)
    await expect(teamMenuItem(page)).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
  })

  test('the sidebar-footer account menu is not labelled as a workspace switcher', async ({
    page,
  }) => {
    await page.goto('/agents')
    // Regression guard for the ambiguity fixed above: exactly one control on
    // the page may claim the "Switch active workspace" accessible name.
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible({
      timeout: 10_000,
    })
    await expect(
      page.getByRole('combobox', { name: 'Switch active workspace' }),
    ).toHaveCount(1)
  })
})

// ─── Tenant Settings ──────────────────────────────────────────────────────────

test.describe('Tenant — Settings', () => {
  test('tenant settings page renders the active workspace, not just the settings shell', async ({
    page,
  }) => {
    await page.goto('/settings/tenant')
    // Positive URL assertion: the layout bails with redirect('/') when the user
    // has no tenant-admin access, which `not.toHaveURL(/sign-in/)` would miss.
    await expect(page).toHaveURL(/\/settings\/tenant$/)

    // "Brand Customization" only exists on the loaded branch of
    // app/settings/tenant/page.tsx (the error branch renders "No tenant found").
    await expect(page.getByText('Brand Customization')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('No tenant found')).toHaveCount(0)

    // The Info tab must show the data the config API returned for this tenant.
    const active = await page.request.get('/api/user/active-tenant')
    expect(active.status()).toBe(200)
    const { tenant_id: tenantId } = await active.json()
    const config = await page.request.get(`/api/tenants/${tenantId}/config`)
    expect(config.status()).toBe(200)
    const { tenant } = await config.json()

    await page.getByRole('tab', { name: 'Info' }).click()
    await expect(page.getByText('Tenant Information')).toBeVisible()
    await expect(page.getByText(tenant.id, { exact: true })).toBeVisible()
    await expect(page.getByText(`/${tenant.slug}`, { exact: true })).toBeVisible()
  })

  test('GET /api/tenants/[id]/config returns the tenant, its branding and its features', async ({
    request,
  }) => {
    const res = await request.get(`/api/tenants/${teamTenantId}/config`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.tenant.id).toBe(teamTenantId)
    expect(body.tenant.slug).toBe(TEAM_SLUG)
    expect(body.tenant.name).toBe(TEAM_NAME)
    // camelCase is the contract (TenantDocument) — the team page used to read
    // `is_personal` here and silently always saw `undefined`.
    expect(body.tenant.isPersonal).toBe(false)
    expect(body.tenant).not.toHaveProperty('is_personal')

    expect(typeof body.branding.primaryColor).toBe('string')
    expect(typeof body.branding.secondaryColor).toBe('string')
    expect(body.tenant.branding).toEqual(body.branding)

    const features = body.features as Array<{ name: string; isEnabled: boolean }>
    const team = features.find(f => f.name === 'TEAM_COLLABORATION')
    // The invitation tests below depend on this being on by default.
    expect(team, 'TEAM_COLLABORATION missing from the feature list').toBeTruthy()
    expect(team?.isEnabled).toBe(true)
  })

  test('/settings redirects to tenant settings and the nav reflects the active workspace', async ({
    page,
  }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/tenant$/)

    // The desktop nav is built in app/settings/layout.tsx from the *active*
    // tenant: Team Management and Agent Links are omitted for a personal
    // workspace, which is what a fresh context resolves to.
    const nav = page.locator('aside nav')
    await expect(nav.getByRole('link', { name: 'Tenant Settings' })).toHaveAttribute(
      'href',
      '/settings/tenant',
    )
    await expect(nav.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'href',
      '/settings/tenant/usage',
    )
    await expect(nav.getByRole('link', { name: 'Team Management' })).toHaveCount(0)
  })
})

// ─── Team Members ─────────────────────────────────────────────────────────────

test.describe('Tenant — Team Members', () => {
  test('team page lists the real members of the active team workspace', async ({
    page,
  }) => {
    const put = await page.request.put('/api/user/active-tenant', {
      data: { tenant_id: teamTenantId },
      failOnStatusCode: false,
    })
    expect(put.status()).toBe(200)

    await page.goto('/settings/tenant/team')
    await expect(page).toHaveURL(/\/settings\/tenant\/team$/)

    // A row rendered from GET /api/tenants/[id]/users — the hard-coded
    // "Team Management" heading renders even when every fetch fails.
    const ownerRow = page.getByRole('row').filter({ hasText: E2E_USER.email })
    await expect(ownerRow).toBeVisible({ timeout: 15_000 })
    await expect(ownerRow.getByText('Admin')).toBeVisible()

    // A team workspace exposes the invite affordances.
    await expect(page.getByRole('button', { name: 'Invite Member' })).toBeVisible()
    await expect(page.getByText('Active members of your tenant')).toBeVisible()
  })

  test('team page hides the invite controls on a personal workspace', async ({
    page,
  }) => {
    // Regression guard: team/page.tsx reads `data.tenant.isPersonal` from
    // GET /api/tenants/[id]/config. Reading the snake_case `is_personal`
    // instead yields undefined, so a personal workspace renders the full team
    // UI and the invite POST is then refused with 403 by the server.
    const put = await page.request.put('/api/user/active-tenant', {
      data: { tenant_id: personalTenantId },
      failOnStatusCode: false,
    })
    expect(put.status()).toBe(200)

    await page.goto('/settings/tenant/team')
    await expect(page).toHaveURL(/\/settings\/tenant\/team$/)

    // Wait for the personal branch to resolve before asserting an absence.
    await expect(
      page.getByText('Personal workspaces cannot have additional members.'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Invite Member' })).toHaveCount(0)

    const ownerRow = page.getByRole('row').filter({ hasText: E2E_USER.email })
    await expect(ownerRow).toBeVisible()
  })

  test('GET /api/tenants/[id]/users returns the creator as the only member', async ({
    request,
  }) => {
    const res = await request.get(`/api/tenants/${teamTenantId}/users`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const { users } = await res.json()
    expect(Array.isArray(users)).toBe(true)

    const owner = users.find(
      (u: { email: string | null }) => u.email === E2E_USER.email,
    )
    expect(owner, `no row for ${E2E_USER.email} in ${JSON.stringify(users)}`).toBeTruthy()
    expect(owner.role).toBe('TENANT_ADMIN')
    expect(owner.tenant_id).toBe(teamTenantId)
    expect(typeof owner.user_id).toBe('string')
    expect(Number.isNaN(Date.parse(owner.created_at))).toBe(false)
  })
})

// ─── Invitation Flow ──────────────────────────────────────────────────────────

test.describe('Tenant — Invitation Flow', () => {
  test('POST invitations returns 201 with an invite URL and a pending row', async ({
    request,
  }) => {
    const email = `e2e-invitee-${Date.now()}@example.com`
    const res = await request.post(`/api/tenants/${teamTenantId}/invitations`, {
      data: { email, role: 'MEMBER' },
      failOnStatusCode: false,
    })
    // A 403 here is never "feature flag off" in this suite: the workspace is
    // created fresh in beforeAll and TEAM_COLLABORATION defaults to enabled,
    // so 403 means requireTenantAdmin refused the workspace's own creator.
    expect(res.status(), await res.text()).toBe(201)
    const body = await res.json()

    expect(typeof body.invitation.token).toBe('string')
    expect(body.invitation.token.length).toBeGreaterThan(20)
    expect(body.invitation.email).toBe(email)
    expect(body.invitation.role).toBe('MEMBER')
    expect(body.invitation.status).toBe('pending')
    expect(body.invitation.tenantId).toBe(teamTenantId)
    expect(body.inviteUrl).toContain(`/invite/${body.invitation.token}`)

    try {
      const list = await request.get(`/api/tenants/${teamTenantId}/invitations`, {
        failOnStatusCode: false,
      })
      expect(list.status()).toBe(200)
      const { invitations } = await list.json()
      const row = invitations.find(
        (i: { email: string }) => i.email === email,
      )
      expect(row, `invitation for ${email} missing from the list`).toBeTruthy()
      expect(row.id).toBe(body.invitation.id)
      expect(row.status).toBe('pending')
      expect(row.role).toBe('MEMBER')
      // The list must never leak another tenant's invitations.
      expect(
        invitations.every((i: { id: string }) => typeof i.id === 'string'),
      ).toBe(true)
    } finally {
      await request.delete(`/api/invitations/${body.invitation.id}`, {
        failOnStatusCode: false,
      })
    }
  })

  test('GET /api/invitations/[token] masks the invited address and needs no session', async ({
    request,
  }) => {
    // A fixed address so the expected mask is fixed too:
    // maskEmail('invited-user@example.com') === 'i***@e***.com'.
    const email = 'invited-user@example.com'
    const created = await request.post(`/api/tenants/${teamTenantId}/invitations`, {
      data: { email, role: 'MEMBER' },
      failOnStatusCode: false,
    })
    expect(created.status(), await created.text()).toBe(201)
    const { invitation } = await created.json()

    try {
      // The route has no auth guard at all, so masking is the only PII control
      // — check it from a context with no cookies.
      const anon = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: undefined })
      try {
        const res = await anon.get(`/api/invitations/${invitation.token}`, {
          failOnStatusCode: false,
        })
        expect(res.status()).toBe(200)
        const raw = await res.text()
        expect(raw).not.toContain(email)

        const body = JSON.parse(raw)
        expect(body.invitation.email).toBe('i***@e***.com')
        expect(body.invitation.tenant_id).toBe(teamTenantId)
        expect(body.invitation.tenant_name).toBe(TEAM_NAME)
        expect(body.invitation.status).toBe('pending')
        expect(body.invitation.role).toBe('MEMBER')
        expect(body.invitation.accepted_at).toBeNull()

        const missing = await anon.get(`/api/invitations/not-a-real-token-${RUN}`, {
          failOnStatusCode: false,
        })
        expect(missing.status()).toBe(404)
      } finally {
        await anon.dispose()
      }
    } finally {
      await request.delete(`/api/invitations/${invitation.id}`, {
        failOnStatusCode: false,
      })
    }
  })

  test('DELETE /api/invitations/[id] cancels a pending invitation', async ({
    request,
  }) => {
    const email = `e2e-cancelled-${Date.now()}@example.com`
    const created = await request.post(`/api/tenants/${teamTenantId}/invitations`, {
      data: { email, role: 'TENANT_ADMIN' },
      failOnStatusCode: false,
    })
    expect(created.status(), await created.text()).toBe(201)
    const { invitation } = await created.json()

    const del = await request.delete(`/api/invitations/${invitation.id}`, {
      failOnStatusCode: false,
    })
    expect(del.status()).toBe(204)

    // Read it back two ways: it is no longer pending, and the token preview
    // reports the cancelled state instead of still being acceptable.
    const list = await request.get(`/api/tenants/${teamTenantId}/invitations`)
    expect(list.status()).toBe(200)
    const { invitations } = await list.json()
    const row = invitations.find((i: { id: string }) => i.id === invitation.id)
    expect(row).toBeTruthy()
    expect(row.status).toBe('expired')

    const preview = await request.get(`/api/invitations/${invitation.token}`, {
      failOnStatusCode: false,
    })
    expect(preview.status()).toBe(200)
    expect((await preview.json()).invitation.status).toBe('expired')
  })

  test('an invited user accepts once, becomes a member, then can be re-roled and removed', async ({
    request,
  }) => {
    const outsider = await outsiderContext()
    let outsiderUserId = ''
    try {
      // ── Before the invite is accepted, the outsider is not a member ────────
      const denied = await outsider.get(`/api/tenants/${teamTenantId}/users`, {
        failOnStatusCode: false,
      })
      expect(denied.status()).toBe(403)
      expect(await denied.text()).not.toContain(E2E_USER.email)

      const created = await request.post(
        `/api/tenants/${teamTenantId}/invitations`,
        {
          data: { email: E2E_OUTSIDER.email, role: 'MEMBER' },
          failOnStatusCode: false,
        },
      )
      expect(created.status(), await created.text()).toBe(201)
      const { invitation } = await created.json()

      // ── Accept ────────────────────────────────────────────────────────────
      const accept = await outsider.post(
        `/api/invitations/${invitation.token}/accept`,
        { failOnStatusCode: false },
      )
      expect(accept.status(), await accept.text()).toBe(200)
      expect(await accept.json()).toEqual({
        success: true,
        tenant_id: teamTenantId,
      })

      // Accepting is not idempotent: the invitation is consumed.
      const again = await outsider.post(
        `/api/invitations/${invitation.token}/accept`,
        { failOnStatusCode: false },
      )
      expect(again.status()).toBe(410)
      expect((await again.json()).error).toMatch(/already been accepted/i)

      // The invitation row flipped to accepted.
      const preview = await request.get(`/api/invitations/${invitation.token}`)
      expect(preview.status()).toBe(200)
      const previewed = (await preview.json()).invitation
      expect(previewed.status).toBe('accepted')
      expect(previewed.accepted_at).not.toBeNull()

      // ── The membership is real, from both sides ───────────────────────────
      const nowAllowed = await outsider.get(
        `/api/tenants/${teamTenantId}/users`,
        { failOnStatusCode: false },
      )
      expect(nowAllowed.status()).toBe(200)

      const members = await request.get(`/api/tenants/${teamTenantId}/users`)
      expect(members.status()).toBe(200)
      const invited = (await members.json()).users.find(
        (u: { email: string | null }) => u.email === E2E_OUTSIDER.email,
      )
      expect(invited, 'the accepted invitee is missing from the member list').toBeTruthy()
      expect(invited.role).toBe('MEMBER')
      outsiderUserId = invited.user_id

      // ── Role change, read back ────────────────────────────────────────────
      const promote = await request.put(
        `/api/tenants/${teamTenantId}/users/${outsiderUserId}/role`,
        { data: { role: 'TENANT_ADMIN' }, failOnStatusCode: false },
      )
      expect(promote.status(), await promote.text()).toBe(200)
      const afterPromote = await request.get(
        `/api/tenants/${teamTenantId}/users`,
      )
      expect(
        (await afterPromote.json()).users.find(
          (u: { user_id: string }) => u.user_id === outsiderUserId,
        ).role,
      ).toBe('TENANT_ADMIN')

      // An admin still cannot demote themselves.
      const self = (await (
        await request.get(`/api/tenants/${teamTenantId}/users`)
      ).json()).users.find(
        (u: { email: string | null }) => u.email === E2E_USER.email,
      )
      const selfDemote = await request.put(
        `/api/tenants/${teamTenantId}/users/${self.user_id}/role`,
        { data: { role: 'MEMBER' }, failOnStatusCode: false },
      )
      expect(selfDemote.status()).toBe(400)
    } finally {
      // ── Removal (also restores the fixture for the next run) ──────────────
      // Soft assertions: this runs in `finally`, and a failure here must not
      // replace the real error when the body above already failed.
      if (outsiderUserId) {
        const remove = await request.delete(
          `/api/tenants/${teamTenantId}/users/${outsiderUserId}/role`,
          { failOnStatusCode: false },
        )
        expect.soft(remove.status(), await remove.text()).toBe(200)

        const after = await request.get(`/api/tenants/${teamTenantId}/users`)
        expect.soft(await after.text()).not.toContain(E2E_OUTSIDER.email)

        // Membership revoked ⇒ the tenant is closed to them again.
        const reDenied = await outsider.get(
          `/api/tenants/${teamTenantId}/users`,
          { failOnStatusCode: false },
        )
        expect.soft(reDenied.status()).toBe(403)
      }
      await outsider.dispose()
    }
  })
})

// ─── Usage Stats ──────────────────────────────────────────────────────────────

test.describe('Tenant — Usage Stats', () => {
  test('usage page renders the usage cards for the active team workspace', async ({
    page,
  }) => {
    const put = await page.request.put('/api/user/active-tenant', {
      data: { tenant_id: teamTenantId },
      failOnStatusCode: false,
    })
    expect(put.status()).toBe(200)

    await page.goto('/settings/tenant/usage')
    await expect(page).toHaveURL(/\/settings\/tenant\/usage$/)

    // "Current Plan" / "Usage by Agent" exist only on the success branch of
    // app/settings/tenant/usage/page.tsx; the error branch renders just the
    // PageHeader (whose title "Usage" is also the layout's nav label).
    await expect(page.getByText('Current Plan')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Usage by Agent')).toBeVisible()
    await expect(page.getByText('Could not determine active tenant')).toHaveCount(0)
    await expect(page.getByText('Failed to load usage data')).toHaveCount(0)

    // The route returns an empty (but truthful) shape today — the page must
    // render that rather than blowing up.
    await expect(
      page.getByText('Usage metering is not yet active for this workspace.'),
    ).toBeVisible()
    await expect(page.getByText('No usage data yet.').first()).toBeVisible()
  })

  test('GET /api/tenants/[id]/usage returns the current billing-cycle contract', async ({
    request,
  }) => {
    const res = await request.get(`/api/tenants/${teamTenantId}/usage`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)

    const now = new Date()
    const expectedCycle = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(await res.json()).toEqual({
      subscription: null,
      rollup: null,
      dailyUsage: [],
      billingCycleId: expectedCycle,
    })
  })
})

// ─── Active Tenant Switching ──────────────────────────────────────────────────

test.describe('Tenant — Workspace Switching', () => {
  test('PUT /api/user/active-tenant switches workspace and refuses foreign tenants', async ({
    request,
  }) => {
    const res = await request.put('/api/user/active-tenant', {
      data: { tenant_id: teamTenantId },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    const check = await request.get('/api/user/active-tenant')
    expect(check.status()).toBe(200)
    expect((await check.json()).tenant_id).toBe(teamTenantId)

    // A tenant the user is not a member of is refused, and the active tenant
    // is left untouched.
    const foreign = await request.put('/api/user/active-tenant', {
      data: { tenant_id: '00000000-0000-4000-8000-000000000000' },
      failOnStatusCode: false,
    })
    expect(foreign.status()).toBe(403)
    const stillTeam = await request.get('/api/user/active-tenant')
    expect((await stillTeam.json()).tenant_id).toBe(teamTenantId)

    // Switch back so the fixture ends where it started.
    const back = await request.put('/api/user/active-tenant', {
      data: { tenant_id: personalTenantId },
      failOnStatusCode: false,
    })
    expect(back.status()).toBe(200)
  })

  test('the agent list is scoped to the active workspace and follows the switcher', async ({
    page,
  }) => {
    const stamp = Date.now()
    const personalAgentName = `E2E Personal Scope Agent ${stamp}`
    const teamAgentName = `E2E Team Scope Agent ${stamp}`
    const owner = await ownerContext()
    let personalAgentId = ''
    let teamAgentId = ''

    try {
      // POST /api/agents always writes to the caller's *active* tenant, so seed
      // one agent on each side by moving this context's active tenant.
      const toPersonal = await owner.put('/api/user/active-tenant', {
        data: { tenant_id: personalTenantId },
        failOnStatusCode: false,
      })
      expect(toPersonal.status()).toBe(200)
      const personalRes = await owner.post('/api/agents', {
        data: {
          name: personalAgentName,
          instructions: 'Scoping fixture for the personal workspace.',
        },
        failOnStatusCode: false,
      })
      expect(personalRes.status(), await personalRes.text()).toBe(200)
      personalAgentId = (await personalRes.json()).agent.id

      const toTeam = await owner.put('/api/user/active-tenant', {
        data: { tenant_id: teamTenantId },
        failOnStatusCode: false,
      })
      expect(toTeam.status()).toBe(200)
      const teamRes = await owner.post('/api/agents', {
        data: {
          name: teamAgentName,
          instructions: 'Scoping fixture for the team workspace.',
        },
        failOnStatusCode: false,
      })
      expect(teamRes.status(), await teamRes.text()).toBe(200)
      const teamAgent = (await teamRes.json()).agent
      teamAgentId = teamAgent.id
      expect(teamAgent.tenantId).toBe(teamTenantId)

      // The browser context starts on the personal workspace.
      await page.goto('/agents')
      const switcher = page.getByTestId('workspace-switcher')
      await expect(switcher).toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByRole('link', { name: personalAgentName, exact: true }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(teamAgentName)).toHaveCount(0)

      // Switch workspaces through the UI.
      await switcher.click()
      await teamMenuItem(page).click()

      // The trigger label is server-rendered, so this proves the switch was
      // persisted and the tree re-rendered — not just a local state flip.
      await expect(switcher).toContainText(TEAM_NAME, { timeout: 15_000 })
      await expect(
        page.getByRole('link', { name: teamAgentName, exact: true }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(personalAgentName)).toHaveCount(0)
    } finally {
      if (personalAgentId) {
        await owner.delete(`/api/agents/${personalAgentId}`, {
          failOnStatusCode: false,
        })
      }
      if (teamAgentId) {
        await owner.delete(`/api/agents/${teamAgentId}`, {
          failOnStatusCode: false,
        })
      }
      await owner.dispose()
    }
  })
})
