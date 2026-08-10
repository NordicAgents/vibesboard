/**
 * Section 10 — Admin Panel (Superadmin Only)
 *
 * Tests the superadmin-only admin panel including:
 *   - Access control (unauthenticated → sign-in, regular user → /agents,
 *     non-superadmin → 403 from every mutating /api/admin/* endpoint)
 *   - Tenant list (pagination envelope + the rows the page actually renders)
 *   - Tenant create / update / delete, each verified by reading the row back
 *   - Tenant detail: name heading, all six tabs, overview fields, agents tab
 *   - Tenant usage endpoint (the documented zero shape)
 *   - Platform branding settings (round-tripped through GET, and through the
 *     form inputs the branding page renders)
 *   - File processing monitor (rendered stats compared against the API)
 *   - Agent viewer (cross-tenant read + 404 for an unknown id)
 *
 * Superadmin credentials: superadmin@vibesboard.local / SuperAdmin123!
 * (seeded and promoted by e2e/local/global-setup.ts)
 *
 * Conventions used here:
 *   - Every API assertion pins the ONE status the handler returns, and every
 *     mutation is read back. `res.ok()` alone is not an assertion.
 *   - No test guards itself with `test.skip()`: the tenant-CRUD block is
 *     `describe.serial` with the fixture created in `beforeAll`, so a broken
 *     precondition is reported as a failure (and the whole block is re-run on
 *     retry, which re-establishes the shared id).
 *   - Cross-tenant reads of agents/conversations/files live in
 *     12-tenant-isolation.spec.ts and are not duplicated here; this file only
 *     covers the admin endpoints that spec does not touch.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { BASE_URL, STORAGE_STATE, E2E_USER } from '../constants.ts'

// ─── Superadmin session ─────────────────────────────────────────────────────
const ADMIN_EMAIL = 'superadmin@vibesboard.local'
const ADMIN_STATE = 'e2e/.auth/admin.json'

// ─── Regular user session (for access-control tests) ────────────────────────
const REGULAR_STATE = STORAGE_STATE // e2e-tester@vibesboard.local

// Syntactically valid uuid that no row can hold (uuidv7 never produces it), so
// "not found" paths are exercised without tripping a Postgres cast error.
const MISSING_UUID = '00000000-0000-0000-0000-0000000000ff'

/** Slug prefix swept by global-setup (`DELETE ... slug LIKE 'e2e-admin-tenant-%'`). */
const TENANT_SLUG_PREFIX = 'e2e-admin-tenant'

function adminApi() {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: ADMIN_STATE,
  })
}

function ownerApi() {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: REGULAR_STATE,
  })
}

// ─── Access Control ──────────────────────────────────────────────────────────

test.describe('Admin Access Control', () => {
  test('unauthenticated user is redirected away from /admin', async ({ browser }) => {
    // Fresh context with no cookies
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await ctx.newPage()
    await page.goto('/admin')
    // Should redirect to sign-in
    await expect(page).toHaveURL(/sign-in/, { timeout: 8_000 })
    await ctx.close()
  })

  test('regular user cannot access /admin (redirected to /agents)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: REGULAR_STATE })
    const page = await ctx.newPage()
    await page.goto('/admin')
    // Non-superadmin is redirected to /agents
    await expect(page).toHaveURL(/agents/, { timeout: 8_000 })
    await expect(page).not.toHaveURL(/admin/)
    // …and none of the admin chrome rendered on the way out.
    await expect(page.getByText('System Management')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toHaveCount(0)
    await ctx.close()
  })

  test('superadmin can access /admin and sees the dashboard', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_STATE })
    const page = await ctx.newPage()
    await page.goto('/admin')
    // The <h1> only app/admin/page.tsx renders — not layout chrome.
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/admin$/)
    await ctx.close()
  })
})

// ─── Admin Dashboard ─────────────────────────────────────────────────────────

test.describe('Admin Dashboard', () => {
  test.use({ storageState: ADMIN_STATE })

  test('admin landing page shows the three navigation cards', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({
      timeout: 10_000,
    })

    // Each card link's accessible name contains its description, which the
    // sidebar links (named just "Tenants"/"Branding"/"File Processing") do not
    // have — so these locators cannot be satisfied by layout chrome.
    const cards: Array<[string, string]> = [
      ['/admin/tenants', 'Manage organizations and their settings'],
      ['/admin/branding', 'Set platform-wide default branding'],
      ['/admin/files', 'Monitor RAG file processing status'],
    ]
    for (const [href, description] of cards) {
      const card = page.getByRole('link', { name: new RegExp(description, 'i') })
      await expect(card).toHaveCount(1)
      await expect(card).toHaveAttribute('href', href)
    }

    // The card grid is navigable, not just decorative.
    await page.getByRole('link', { name: /Manage organizations and their settings/i }).click()
    await expect(page).toHaveURL(/\/admin\/tenants$/)
  })

  test('admin sidebar shows Tenants, Branding, File Processing links', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({
      timeout: 10_000,
    })

    // Scope to <aside> so the dashboard cards cannot satisfy these.
    const sidebar = page.locator('aside')
    for (const [label, href] of [
      ['Tenants', '/admin/tenants'],
      ['Branding', '/admin/branding'],
      ['File Processing', '/admin/files'],
    ] as const) {
      const link = sidebar.getByRole('link', { name: label, exact: true })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('href', href)
    }
  })
})

// ─── Tenant Management ───────────────────────────────────────────────────────
//
// Serial: the fixture tenant is created once in beforeAll and deleted by the
// last test. Serial mode re-runs the whole block (including beforeAll) on
// retry, so the shared id is always re-established instead of silently
// vanishing into `test.skip()`.

test.describe.serial('Admin — Tenant Management', () => {
  test.use({ storageState: ADMIN_STATE })

  const stamp = Date.now()
  let fixtureId = ''
  let fixtureName = `E2E Admin Tenant ${stamp}`
  let fixtureSlug = `${TENANT_SLUG_PREFIX}-${stamp}`
  let fixtureDeleted = false

  test.beforeAll(async () => {
    const admin = await adminApi()
    try {
      const res = await admin.post('/api/admin/tenants', {
        data: { name: fixtureName, slug: fixtureSlug },
        failOnStatusCode: false,
      })
      if (res.status() !== 201) {
        throw new Error(
          `fixture tenant create failed (${res.status()}): ${await res.text()}`,
        )
      }
      fixtureId = (await res.json()).tenant?.id
      if (!fixtureId) throw new Error('fixture tenant create returned no id')
    } finally {
      await admin.dispose()
    }
  })

  test.afterAll(async () => {
    if (fixtureDeleted || !fixtureId) return
    const admin = await adminApi()
    try {
      await admin.delete(`/api/admin/tenants/${fixtureId}`, { failOnStatusCode: false })
    } finally {
      await admin.dispose()
    }
  })

  test('POST /api/admin/tenants creates (201), rejects duplicates (409) and bad input (400)', async ({
    request,
  }) => {
    const slug = `${TENANT_SLUG_PREFIX}-dup-${Date.now()}`
    const name = `E2E Admin Dup ${Date.now()}`

    const created = await request.post('/api/admin/tenants', {
      data: { name, slug },
      failOnStatusCode: false,
    })
    expect(created.status(), await created.text()).toBe(201)
    const { tenant } = await created.json()
    expect(tenant.slug).toBe(slug)
    expect(tenant.name).toBe(name)
    expect(tenant.isPersonal).toBe(false)
    expect(tenant.status).toBe('active')

    // The row is really there.
    const readBack = await request.get(`/api/admin/tenants/${tenant.id}`, {
      failOnStatusCode: false,
    })
    expect(readBack.status()).toBe(200)
    expect((await readBack.json()).tenant.slug).toBe(slug)

    // Same slug twice → 409, not a silent second row.
    const dup = await request.post('/api/admin/tenants', {
      data: { name, slug },
      failOnStatusCode: false,
    })
    expect(dup.status()).toBe(409)
    expect((await dup.json()).error).toBe('Tenant slug already exists')

    // Name shorter than 2 chars → 400.
    const badName = await request.post('/api/admin/tenants', {
      data: { name: 'A', slug: `${slug}-x` },
      failOnStatusCode: false,
    })
    expect(badName.status()).toBe(400)
    expect((await badName.json()).error).toBe('Invalid tenant name')

    // Slug that is not kebab-case → 400.
    const badSlug = await request.post('/api/admin/tenants', {
      data: { name: 'E2E Admin Bad Slug', slug: 'Not A Slug!' },
      failOnStatusCode: false,
    })
    expect(badSlug.status()).toBe(400)
    expect((await badSlug.json()).error).toBe('Invalid tenant slug')

    // Clean up the throwaway tenant (global-setup also sweeps this prefix).
    const removed = await request.delete(`/api/admin/tenants/${tenant.id}`, {
      failOnStatusCode: false,
    })
    expect(removed.status()).toBe(200)
  })

  test('GET /api/admin/tenants returns a consistent page envelope containing the fixture', async ({
    request,
  }) => {
    const res = await request.get('/api/admin/tenants?page=1&limit=500', {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(Array.isArray(body.tenants)).toBe(true)
    expect(body.pagination.page).toBe(1)
    expect(body.pagination.limit).toBe(500)
    expect(typeof body.pagination.total).toBe('number')
    // The envelope must describe the page it actually returned.
    expect(body.tenants.length).toBe(Math.min(body.pagination.total, 500))
    expect(body.pagination.totalPages).toBe(Math.ceil(body.pagination.total / 500))

    const fixture = body.tenants.find((t: { id: string }) => t.id === fixtureId)
    expect(fixture, 'fixture tenant missing from the admin tenant list').toBeTruthy()
    expect(fixture.slug).toBe(fixtureSlug)
    expect(fixture.isPersonal).toBe(false)
    // createTenantAsAdmin adds the creator as TENANT_ADMIN — exactly one member.
    expect(fixture.user_count).toBe(1)
    expect(fixture.creator_email).toBe(ADMIN_EMAIL)

    // Documented default page size: the UI must pass an explicit limit or it
    // only ever sees the 10 newest tenants.
    const dflt = await request.get('/api/admin/tenants', { failOnStatusCode: false })
    expect(dflt.status()).toBe(200)
    const dfltBody = await dflt.json()
    expect(dfltBody.pagination.limit).toBe(10)
    expect(dfltBody.tenants.length).toBeLessThanOrEqual(10)
  })

  test('tenants page renders the fixture row, its counters agree with the API, and rows navigate', async ({
    page,
    request,
  }) => {
    const listRes = await request.get('/api/admin/tenants?page=1&limit=500', {
      failOnStatusCode: false,
    })
    expect(listRes.status()).toBe(200)
    const { pagination } = await listRes.json()

    await page.goto('/admin/tenants')
    const search = page.getByPlaceholder('Search by name or slug...')
    await expect(search).toBeVisible({ timeout: 15_000 })

    // The "All" filter chip counts the rows the page fetched. If the page ever
    // goes back to the API default of 10 while more tenants exist, this fails.
    const expectedAll = Math.min(pagination.total, 500)
    await expect(
      page.getByRole('button', {
        name: `All ${expectedAll}`,
        exact: true,
      }),
    ).toBeVisible()

    await search.fill(fixtureSlug)
    const row = page.getByRole('row').filter({ hasText: fixtureName })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(ADMIN_EMAIL) // Owner column
    await expect(row).toContainText(/active/i) // Status badge

    await row.click()
    await expect(page).toHaveURL(new RegExp(`/admin/tenants/${fixtureId}$`))
  })

  test('tenants page lists the e2e-tester personal workspace with its owner', async ({
    page,
  }) => {
    await page.goto('/admin/tenants')
    const search = page.getByPlaceholder('Search by name or slug...')
    await expect(search).toBeVisible({ timeout: 15_000 })

    // The personal workspace is provisioned by the on-user-create hook with a
    // slug taken from the email local part.
    await search.fill('e2e-tester')
    const row = page.getByRole('row').filter({ hasText: E2E_USER.email })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(E2E_USER.name)
    await expect(row).toContainText('Personal')
  })

  test('GET /api/admin/tenants/[id] returns the tenant detail, 404 for an unknown id', async ({
    request,
  }) => {
    const res = await request.get(`/api/admin/tenants/${fixtureId}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.tenant.id).toBe(fixtureId)
    expect(body.tenant.name).toBe(fixtureName)
    expect(body.tenant.slug).toBe(fixtureSlug)
    expect(body.tenant.isPersonal).toBe(false)
    expect(body.user_count).toBe(1)
    // A fresh tenant has no branding row of its own (it inherits the platform's).
    expect(body.branding).toBeNull()

    const missing = await request.get(`/api/admin/tenants/${MISSING_UUID}`, {
      failOnStatusCode: false,
    })
    expect(missing.status()).toBe(404)
    expect((await missing.json()).error).toBe('Tenant not found')
  })

  test('GET /api/admin/tenants/[id]/usage returns the documented zero shape', async ({
    request,
  }) => {
    const res = await request.get(`/api/admin/tenants/${fixtureId}/usage`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.subscription).toBeNull()
    expect(body.rollup).toBeNull()
    expect(body.agentNames).toEqual({})
    expect(body.userNames).toEqual({})
    expect(body.dailyUsage).toEqual([])

    const now = new Date()
    const cycle = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(body.billingCycleId).toBe(cycle)
  })

  test('tenant detail page shows the tenant, all six tabs and switches panels', async ({
    page,
  }) => {
    await page.goto(`/admin/tenants/${fixtureId}`)

    // The loading skeleton renders neither the name nor the tabs, and a failed
    // fetch redirects to /admin/tenants — both would fail these assertions.
    await expect(page.getByRole('heading', { name: fixtureName })).toBeVisible({
      timeout: 15_000,
    })
    for (const label of ['Overview', 'Branding', 'Features', 'Users', 'Agents', 'Usage']) {
      await expect(
        page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') }),
      ).toBeVisible()
    }

    // Default panel = Overview, rendering this tenant's own fields.
    const overview = page.getByRole('tabpanel')
    await expect(overview).toContainText('Tenant Information')
    await expect(overview.getByRole('textbox')).toHaveValue(fixtureId)
    await expect(overview).toContainText(`/${fixtureSlug}`)

    // Switching tabs swaps the panel for one only the Agents tab renders.
    await page.getByRole('tab', { name: /^Agents$/i }).click()
    const agents = page.getByRole('tabpanel')
    await expect(agents).toContainText('Agents created in this tenant workspace')
    await expect(agents).toContainText('No agents created')
  })

  test('PUT /api/admin/tenants/[id] renames the tenant and the change is readable back', async ({
    request,
  }) => {
    const updatedName = `${fixtureName} Updated`
    const updatedSlug = `${fixtureSlug}-updated`

    const res = await request.put(`/api/admin/tenants/${fixtureId}`, {
      data: { name: updatedName, slug: updatedSlug },
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    const { tenant } = await res.json()
    expect(tenant.name).toBe(updatedName)
    expect(tenant.slug).toBe(updatedSlug)

    // Read it back: a handler that returns 200 without writing fails here.
    const readBack = await request.get(`/api/admin/tenants/${fixtureId}`, {
      failOnStatusCode: false,
    })
    expect(readBack.status()).toBe(200)
    const detail = await readBack.json()
    expect(detail.tenant.name).toBe(updatedName)
    expect(detail.tenant.slug).toBe(updatedSlug)

    fixtureName = updatedName
    fixtureSlug = updatedSlug
  })

  test('PUT /api/admin/tenants/[id] rejects an empty patch (400) and an unknown id (404)', async ({
    request,
  }) => {
    const empty = await request.put(`/api/admin/tenants/${fixtureId}`, {
      data: {},
      failOnStatusCode: false,
    })
    expect(empty.status()).toBe(400)
    expect((await empty.json()).error).toBe('No valid fields to update')

    // …and the rejected patch changed nothing.
    const unchanged = await request.get(`/api/admin/tenants/${fixtureId}`, {
      failOnStatusCode: false,
    })
    expect(unchanged.status()).toBe(200)
    expect((await unchanged.json()).tenant.name).toBe(fixtureName)

    const missing = await request.put(`/api/admin/tenants/${MISSING_UUID}`, {
      data: { name: 'E2E Admin Ghost' },
      failOnStatusCode: false,
    })
    expect(missing.status()).toBe(404)
    expect((await missing.json()).error).toBe('Tenant not found')
  })

  test('DELETE /api/admin/tenants/[id] removes the tenant; re-reads and re-deletes are 404', async ({
    request,
  }) => {
    const res = await request.delete(`/api/admin/tenants/${fixtureId}`, {
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    expect((await res.json()).success).toBe(true)
    fixtureDeleted = true

    const check = await request.get(`/api/admin/tenants/${fixtureId}`, {
      failOnStatusCode: false,
    })
    expect(check.status()).toBe(404)

    const again = await request.delete(`/api/admin/tenants/${fixtureId}`, {
      failOnStatusCode: false,
    })
    expect(again.status()).toBe(404)

    // It is gone from the list too.
    const list = await request.get('/api/admin/tenants?page=1&limit=500', {
      failOnStatusCode: false,
    })
    expect(list.status()).toBe(200)
    const ids = (await list.json()).tenants.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(fixtureId)
  })
})

// ─── Admin API is superadmin-only ────────────────────────────────────────────
//
// 12-tenant-isolation.spec.ts already covers GET /api/admin/tenants,
// GET /api/admin/platform-branding and POST /api/admin/tenants for a
// non-superadmin. This block covers the endpoints it does not: the per-tenant
// mutations, platform-branding writes, the usage route and the file processor —
// i.e. everything that could delete or rewrite another tenant's data.

test.describe('Admin API refuses a non-superadmin', () => {
  test.use({ storageState: REGULAR_STATE })

  let victimId = ''
  let victimName = ''

  test.beforeAll(async () => {
    const admin = await adminApi()
    try {
      const stamp = Date.now()
      victimName = `E2E Admin Guard ${stamp}`
      const res = await admin.post('/api/admin/tenants', {
        data: { name: victimName, slug: `${TENANT_SLUG_PREFIX}-guard-${stamp}` },
        failOnStatusCode: false,
      })
      if (res.status() !== 201) {
        throw new Error(
          `guard fixture tenant create failed (${res.status()}): ${await res.text()}`,
        )
      }
      victimId = (await res.json()).tenant?.id
      if (!victimId) throw new Error('guard fixture tenant create returned no id')
    } finally {
      await admin.dispose()
    }
  })

  test.afterAll(async () => {
    if (!victimId) return
    const admin = await adminApi()
    try {
      await admin.delete(`/api/admin/tenants/${victimId}`, { failOnStatusCode: false })
    } finally {
      await admin.dispose()
    }
  })

  test('the regular session is valid (so 403 below means denied, not logged out)', async ({
    request,
  }) => {
    const res = await request.get('/api/agents', { failOnStatusCode: false })
    expect(res.status()).toBe(200)
  })

  test('GET /api/admin/tenants/[id] refuses a non-superadmin', async ({ request }) => {
    const res = await request.get(`/api/admin/tenants/${victimId}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain(victimName)
  })

  test('GET /api/admin/tenants/[id]/usage refuses a non-superadmin', async ({ request }) => {
    const res = await request.get(`/api/admin/tenants/${victimId}/usage`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
  })

  test('PUT /api/admin/tenants/[id] refuses a non-superadmin and writes nothing', async ({
    request,
  }) => {
    const res = await request.put(`/api/admin/tenants/${victimId}`, {
      data: { name: 'Pwned By Regular User' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)

    const admin = await adminApi()
    try {
      const check = await admin.get(`/api/admin/tenants/${victimId}`, {
        failOnStatusCode: false,
      })
      expect(check.status()).toBe(200)
      expect((await check.json()).tenant.name).toBe(victimName)
    } finally {
      await admin.dispose()
    }
  })

  test('DELETE /api/admin/tenants/[id] refuses a non-superadmin and the tenant survives', async ({
    request,
  }) => {
    const res = await request.delete(`/api/admin/tenants/${victimId}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)

    const admin = await adminApi()
    try {
      const check = await admin.get(`/api/admin/tenants/${victimId}`, {
        failOnStatusCode: false,
      })
      expect(check.status()).toBe(200)
      expect((await check.json()).tenant.id).toBe(victimId)
    } finally {
      await admin.dispose()
    }
  })

  test('PUT /api/admin/platform-branding refuses a non-superadmin and writes nothing', async ({
    request,
  }) => {
    const res = await request.put('/api/admin/platform-branding', {
      data: { primaryColor: '#dead00', secondaryColor: '#dead00', logoUrl: null },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)

    const admin = await adminApi()
    try {
      const check = await admin.get('/api/admin/platform-branding', {
        failOnStatusCode: false,
      })
      expect(check.status()).toBe(200)
      expect((await check.json()).branding.primaryColor).not.toBe('#dead00')
    } finally {
      await admin.dispose()
    }
  })

  test('GET/POST /api/admin/files/process refuse a non-superadmin', async ({ request }) => {
    const read = await request.get('/api/admin/files/process', { failOnStatusCode: false })
    expect(read.status()).toBe(403)

    const write = await request.post('/api/admin/files/process', {
      data: { status: 'pending', limit: 1 },
      failOnStatusCode: false,
    })
    expect(write.status()).toBe(403)
  })

  test('unauthenticated requests to the admin API are 401', async () => {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: undefined })
    try {
      const list = await anon.get('/api/admin/tenants', { failOnStatusCode: false })
      expect(list.status()).toBe(401)

      const branding = await anon.get('/api/admin/platform-branding', {
        failOnStatusCode: false,
      })
      expect(branding.status()).toBe(401)

      const files = await anon.post('/api/admin/files/process', {
        data: { status: 'pending', limit: 1 },
        failOnStatusCode: false,
      })
      expect(files.status()).toBe(401)
    } finally {
      await anon.dispose()
    }
  })
})

// ─── Platform Branding ────────────────────────────────────────────────────────
//
// The PUT handler echoes the *request* body in its 200, so `res.ok()` proves
// nothing — every write below is re-read with GET. The original row is captured
// up front and restored in afterAll so this block leaves no trace in the
// platform-wide branding other specs inherit.

test.describe.serial('Admin — Platform Branding', () => {
  test.use({ storageState: ADMIN_STATE })

  type Branding = { primaryColor: string; secondaryColor: string; logoUrl: string | null }
  let original: Branding | undefined

  test.beforeAll(async () => {
    const admin = await adminApi()
    try {
      const res = await admin.get('/api/admin/platform-branding', {
        failOnStatusCode: false,
      })
      if (res.status() !== 200) {
        throw new Error(
          `platform branding read failed (${res.status()}): ${await res.text()}`,
        )
      }
      const b = (await res.json()).branding
      original = {
        primaryColor: b.primaryColor,
        secondaryColor: b.secondaryColor,
        logoUrl: b.logoUrl ?? null,
      }
    } finally {
      await admin.dispose()
    }
  })

  test.afterAll(async () => {
    if (!original) return
    const admin = await adminApi()
    try {
      await admin.put('/api/admin/platform-branding', {
        data: original,
        failOnStatusCode: false,
      })
    } finally {
      await admin.dispose()
    }
  })

  test('GET /api/admin/platform-branding returns hex colors', async ({ request }) => {
    const res = await request.get('/api/admin/platform-branding', {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const { branding } = await res.json()
    expect(branding.primaryColor).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    expect(branding.secondaryColor).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  })

  test('PUT /api/admin/platform-branding persists what it echoes', async ({ request }) => {
    for (const [primary, secondary] of [
      ['#1a2b3c', '#4d5e6f'],
      ['#0f0f0f', '#f0f0f0'],
    ] as const) {
      const put = await request.put('/api/admin/platform-branding', {
        data: { primaryColor: primary, secondaryColor: secondary, logoUrl: null },
        failOnStatusCode: false,
      })
      expect(put.status(), await put.text()).toBe(200)
      expect((await put.json()).branding.primaryColor).toBe(primary)

      // The 200 is built from the request body, so only a re-read proves the
      // upsert actually ran.
      const get = await request.get('/api/admin/platform-branding', {
        failOnStatusCode: false,
      })
      expect(get.status()).toBe(200)
      const { branding } = await get.json()
      expect(branding.primaryColor).toBe(primary)
      expect(branding.secondaryColor).toBe(secondary)
      expect(branding.logoUrl ?? null).toBeNull()
    }
  })

  test('PUT /api/admin/platform-branding rejects invalid input and leaves the row alone', async ({
    request,
  }) => {
    // Known-good baseline so this test does not depend on its neighbours.
    const seed = await request.put('/api/admin/platform-branding', {
      data: { primaryColor: '#112233', secondaryColor: '#445566', logoUrl: null },
      failOnStatusCode: false,
    })
    expect(seed.status()).toBe(200)

    const badColor = await request.put('/api/admin/platform-branding', {
      data: { primaryColor: 'rebeccapurple', secondaryColor: '#ffffff' },
      failOnStatusCode: false,
    })
    expect(badColor.status()).toBe(400)
    expect((await badColor.json()).error).toBe(
      'Invalid color format. Use hex colors (e.g., #000000)',
    )

    const missing = await request.put('/api/admin/platform-branding', {
      data: { secondaryColor: '#ffffff' },
      failOnStatusCode: false,
    })
    expect(missing.status()).toBe(400)
    expect((await missing.json()).error).toBe(
      'primaryColor and secondaryColor are required',
    )

    const badLogo = await request.put('/api/admin/platform-branding', {
      data: {
        primaryColor: '#112233',
        secondaryColor: '#445566',
        logoUrl: 'not-a-url',
      },
      failOnStatusCode: false,
    })
    expect(badLogo.status()).toBe(400)
    expect((await badLogo.json()).error).toBe('Invalid logo URL format')

    const after = await request.get('/api/admin/platform-branding', {
      failOnStatusCode: false,
    })
    expect(after.status()).toBe(200)
    const { branding } = await after.json()
    expect(branding.primaryColor).toBe('#112233')
    expect(branding.secondaryColor).toBe('#445566')
  })

  test('branding page renders the persisted colors in its form', async ({ page, request }) => {
    const put = await request.put('/api/admin/platform-branding', {
      data: { primaryColor: '#123456', secondaryColor: '#abcdef', logoUrl: null },
      failOnStatusCode: false,
    })
    expect(put.status()).toBe(200)

    await page.goto('/admin/branding')
    await expect(page.getByRole('heading', { name: 'Base Branding' })).toBeVisible({
      timeout: 15_000,
    })
    // <Label htmlFor="primary-color"> targets the <input type="color">.
    await expect(page.getByLabel('Primary Color')).toHaveValue('#123456')
    await expect(page.getByLabel('Secondary Color')).toHaveValue('#abcdef')
    await expect(
      page.getByRole('button', { name: 'Save Platform Branding' }),
    ).toBeVisible()
  })
})

// ─── File Processing Monitor ──────────────────────────────────────────────────

test.describe('Admin — File Processing', () => {
  test.use({ storageState: ADMIN_STATE })

  test('GET /api/admin/files/process returns files, stats and a timestamp', async ({
    request,
  }) => {
    const res = await request.get('/api/admin/files/process?limit=100', {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(Array.isArray(body.files)).toBe(true)
    for (const key of ['total', 'pending', 'processing', 'indexed', 'failed']) {
      expect(typeof body.stats[key], `stats.${key} should be a number`).toBe('number')
    }
    expect(body.stats.total).toBeGreaterThanOrEqual(
      body.stats.pending + body.stats.processing + body.stats.indexed + body.stats.failed,
    )
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    expect(body.files.length).toBe(Math.min(body.stats.total, 100))
  })

  test('GET /api/admin/files/process honours the status filter and ignores an unknown one', async ({
    request,
  }) => {
    const indexed = await request.get(
      '/api/admin/files/process?status=indexed&limit=100',
      { failOnStatusCode: false },
    )
    expect(indexed.status()).toBe(200)
    const indexedBody = await indexed.json()
    // stats are global, files are filtered — so the filter's effect is exact.
    expect(indexedBody.files.length).toBe(Math.min(indexedBody.stats.indexed, 100))
    for (const f of indexedBody.files) expect(f.status).toBe('indexed')

    const bogus = await request.get('/api/admin/files/process?status=nope&limit=100', {
      failOnStatusCode: false,
    })
    expect(bogus.status()).toBe(200)
    const bogusBody = await bogus.json()
    expect(bogusBody.files.length).toBe(Math.min(bogusBody.stats.total, 100))
  })

  test('POST /api/admin/files/process reports nothing to do for unknown file ids', async ({
    request,
  }) => {
    // Unknown ids keep this deterministic: it exercises the batch endpoint
    // without re-indexing files other specs own.
    const res = await request.post('/api/admin/files/process', {
      data: { fileIds: [MISSING_UUID], concurrency: 1 },
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.message).toBe('No pending files to process')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })

  test('files page renders the monitor and its numbers match the API', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/files')
    await expect(
      page.getByRole('heading', { name: 'File Processing Monitor' }),
    ).toBeVisible({ timeout: 15_000 })

    // The monitor fetches with limit=100 — mirror it so the counts line up.
    const res = await request.get('/api/admin/files/process?limit=100', {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    const { files, stats } = await res.json()

    // Stat card: <CardDescription>Total Files</CardDescription> + <h3>{total}</h3>
    const totalCard = page.getByText('Total Files', { exact: true }).locator('..')
    await expect(totalCard.getByRole('heading')).toHaveText(String(stats.total))

    const processPending = page.getByRole('button', {
      name: `Process Pending (${stats.pending})`,
    })
    await expect(processPending).toBeVisible()
    expect(await processPending.isDisabled()).toBe(stats.pending === 0)

    const retryFailed = page.getByRole('button', {
      name: `Retry Failed (${stats.failed})`,
    })
    await expect(retryFailed).toBeVisible()
    expect(await retryFailed.isDisabled()).toBe(stats.failed === 0)

    // Nothing is selected on load, so this button is always present and disabled.
    await expect(page.getByRole('button', { name: 'Process Selected (0)' })).toBeDisabled()

    await expect(page.getByText(`Showing ${files.length} files`)).toBeVisible()
    if (files.length === 0) {
      await expect(page.getByText('No files found')).toBeVisible()
    } else {
      await expect(page.getByText(files[0].fileName).first()).toBeVisible()
    }
  })
})

// ─── Agent Viewer ─────────────────────────────────────────────────────────────
//
// /admin/agents/[id] resolves any agent on the platform via getAgentById (no
// tenant scoping at the page layer), so the superadmin must be able to open an
// agent that belongs to another user's workspace.

test.describe.serial('Admin — Agent Viewer', () => {
  test.use({ storageState: ADMIN_STATE })

  const INSTRUCTIONS = 'Admin agent viewer canary instructions for the E2E suite.'
  let agentId = ''
  let agentName = ''
  let agentUrl = ''
  let agentTenantId = ''

  test.beforeAll(async () => {
    // Created by the *regular* user, in that user's own tenant.
    const owner = await ownerApi()
    try {
      agentName = `E2E Admin Viewer Agent ${Date.now()}`
      const res = await owner.post('/api/agents', {
        data: { name: agentName, instructions: INSTRUCTIONS },
        failOnStatusCode: false,
      })
      if (res.status() !== 200) {
        throw new Error(`agent create failed (${res.status()}): ${await res.text()}`)
      }
      const { agent } = await res.json()
      agentId = agent?.id
      agentUrl = agent?.agentUrl
      agentTenantId = agent?.tenantId
      if (!agentId || !agentTenantId) {
        throw new Error(`agent create returned an unusable body: ${JSON.stringify(agent)}`)
      }
    } finally {
      await owner.dispose()
    }
  })

  test.afterAll(async () => {
    if (!agentId) return
    const owner = await ownerApi()
    try {
      await owner.delete(`/api/agents/${agentId}`, { failOnStatusCode: false })
    } finally {
      await owner.dispose()
    }
  })

  test('superadmin can read an agent from another tenant', async ({ page }) => {
    await page.goto(`/admin/agents/${agentId}`)

    await expect(page.getByRole('heading', { name: agentName })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Read-only agent viewer (super admin)')).toBeVisible()
    await expect(page.getByText(agentId).first()).toBeVisible()
    await expect(page.getByText(agentUrl).first()).toBeVisible()
    // The Tenant card links to the owning tenant's admin detail page.
    await expect(page.locator(`a[href="/admin/tenants/${agentTenantId}"]`)).toBeVisible()
    // Instructions are rendered verbatim in the viewer.
    await expect(page.getByText(INSTRUCTIONS)).toBeVisible()
    // upsertAgentSchema defaults allowAnonymous to true (packages/agents
    // schema.ts), so this fixture IS publicly shareable and the viewer offers
    // the share action — sharePath is gated on agent.allowAnonymous.
    await expect(
      page.getByRole('link', { name: 'Open Public Page' }),
    ).toBeVisible()
  })

  test('an unknown agent id renders a 404', async ({ page }) => {
    const res = await page.goto(`/admin/agents/${MISSING_UUID}`)
    expect(res?.status()).toBe(404)
  })
})
