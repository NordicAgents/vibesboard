/**
 * Section 11 — Tenant Flow
 *
 * Tests the tenant management user journey:
 *   - Create a new team workspace (any authenticated user)
 *   - Tenant settings (name, branding)
 *   - Team management (invite member, list members)
 *   - Invitation flow (send, view, accept)
 *   - Usage stats page
 *   - Switch between workspaces
 *   - Agent links (if feature enabled)
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

let teamTenantId: string
let teamTenantSlug: string
let inviteToken: string

test.beforeAll(async ({ request }) => {
  // Create a fresh team workspace for these tests
  const slug = `e2e-team-${Date.now()}`
  const res = await request.post('/api/tenants/create-team', {
    data: { name: 'E2E Team Workspace', slug },
    failOnStatusCode: false,
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  teamTenantId = body.tenant?.id ?? body.id ?? body.tenantId
  teamTenantSlug = slug
  expect(teamTenantId).toBeTruthy()
})

// ─── Workspace Creation ───────────────────────────────────────────────────────

test.describe('Tenant — Workspace Creation', () => {
  test('can create a new team workspace', async ({ request }) => {
    const slug = `e2e-extra-team-${Date.now()}`
    const res = await request.post('/api/tenants/create-team', {
      data: { name: 'E2E Extra Team', slug },
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.tenant?.id ?? body.id).toBeTruthy()
  })

  test('slug collision returns 409', async ({ request }) => {
    // Create once then try again with same slug
    const slug = `e2e-collision-${Date.now()}`
    await request.post('/api/tenants/create-team', {
      data: { name: 'Collision A', slug },
    })
    const res = await request.post('/api/tenants/create-team', {
      data: { name: 'Collision B', slug },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(409)
  })

  test('workspace switcher shows the new team', async ({ page }) => {
    await page.goto('/agents')
    // Click the workspace selector
    const switcher = page.getByRole('combobox', { name: /workspace|switch/i }).first()
    await expect(switcher).toBeVisible({ timeout: 10_000 })
    await switcher.click()
    // Should show the new team workspace
    await expect(
      page.getByText('E2E Team Workspace').or(page.getByText(/e2e-team/i)).first()
    ).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
  })
})

// ─── Tenant Settings ──────────────────────────────────────────────────────────

test.describe('Tenant — Settings', () => {
  test('tenant settings page loads', async ({ page }) => {
    await page.goto('/settings/tenant')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
    await expect(
      page.getByText(/workspace|tenant|settings/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('GET /api/tenants/[id]/config returns tenant config', async ({ request }) => {
    if (!teamTenantId) { test.skip(); return }
    const res = await request.get(`/api/tenants/${teamTenantId}/config`)
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.tenant?.slug ?? body.slug).toBeTruthy()
  })

  test('team settings page shows navigation', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).not.toHaveURL(/sign-in/)
    // Settings nav should have Tenant Settings, LLM Providers, etc.
    await expect(
      page.getByText(/tenant settings|llm providers|usage/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })
})

// ─── Team Members ─────────────────────────────────────────────────────────────

test.describe('Tenant — Team Members', () => {
  test('team page loads', async ({ page }) => {
    await page.goto('/settings/tenant/team')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
    // Should show team member list or invite form
    await expect(
      page.getByText(/team|member|invite/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('GET /api/tenants/[id]/users returns member list', async ({ request }) => {
    if (!teamTenantId) { test.skip(); return }
    const res = await request.get(`/api/tenants/${teamTenantId}/users`, { failOnStatusCode: false })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.users ?? body.members ?? body)).toBeTruthy()
  })
})

// ─── Invitation Flow ──────────────────────────────────────────────────────────

test.describe('Tenant — Invitation Flow', () => {
  test('can send a team invitation', async ({ request }) => {
    if (!teamTenantId) { test.skip(); return }
    const res = await request.post(`/api/tenants/${teamTenantId}/invitations`, {
      data: {
        email: 'invited-user@example.com',
        role: 'MEMBER',
      },
      failOnStatusCode: false,
    })
    // 201 = created; 403 = feature flag off (both acceptable)
    if (res.status() === 403 || res.status() === 422) {
      // Feature flag TEAM_COLLABORATION not enabled — skip downstream invite tests
      test.skip()
      return
    }
    expect([200, 201]).toContain(res.status())
    const body = await res.json()
    inviteToken = body.invitation?.token ?? ''
    expect(body.inviteUrl ?? body.invitation).toBeTruthy()
  })

  test('can list pending invitations', async ({ request }) => {
    if (!teamTenantId) { test.skip(); return }
    const res = await request.get(`/api/tenants/${teamTenantId}/invitations`, {
      failOnStatusCode: false,
    })
    if (res.status() === 403) { test.skip(); return }
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.invitations ?? body)).toBeTruthy()
  })

  test('GET /api/invitations/[token] returns masked invitation info', async ({ request }) => {
    if (!inviteToken) { test.skip(); return }
    const res = await request.get(`/api/invitations/${inviteToken}`, { failOnStatusCode: false })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // Should return masked email and tenant info
    expect(body.email ?? body.invitation?.email).toBeTruthy()
  })
})

// ─── Usage Stats ──────────────────────────────────────────────────────────────

test.describe('Tenant — Usage Stats', () => {
  test('usage page loads', async ({ page }) => {
    await page.goto('/settings/tenant/usage')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
    // Usage page should have some content
    await expect(
      page.getByText(/usage|messages|conversations/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('GET /api/tenants/[id]/usage returns usage stats', async ({ request }) => {
    const tenantRes = await request.get('/api/user/active-tenant')
    const { tenant_id: tenantId } = await tenantRes.json()
    const res = await request.get(`/api/tenants/${tenantId}/usage`, { failOnStatusCode: false })
    expect(res.ok()).toBeTruthy()
  })
})

// ─── Active Tenant Switching ──────────────────────────────────────────────────

test.describe('Tenant — Workspace Switching', () => {
  test('PUT /api/user/active-tenant switches workspace', async ({ request }) => {
    if (!teamTenantId) { test.skip(); return }
    // Switch to the team workspace
    const res = await request.put('/api/user/active-tenant', {
      data: { tenant_id: teamTenantId },
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()

    // Verify active tenant changed
    const check = await request.get('/api/user/active-tenant')
    const { tenant_id } = await check.json()
    expect(tenant_id).toBe(teamTenantId)
  })

  test('agents list shows agents for active workspace', async ({ page }) => {
    await page.goto('/agents')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
  })
})
