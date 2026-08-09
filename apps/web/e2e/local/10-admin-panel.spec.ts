/**
 * Section 10 — Admin Panel (Superadmin Only)
 *
 * Tests the superadmin-only admin panel including:
 *   - Access control (regular users redirected, superadmin gets in)
 *   - Tenant list (view all tenants)
 *   - Tenant create / update / delete
 *   - Tenant detail: overview, agents, users, branding, features, usage tabs
 *   - Platform branding settings
 *   - File processing monitor
 *   - Agent viewer
 *
 * Superadmin credentials: superadmin@vibesboard.local / SuperAdmin123!
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { BASE_URL, STORAGE_STATE, E2E_USER } from '../constants.ts'

// ─── Superadmin session ─────────────────────────────────────────────────────
const ADMIN_EMAIL = 'superadmin@vibesboard.local'
const ADMIN_PASS = 'SuperAdmin123!'
const ADMIN_STATE = 'e2e/.auth/admin.json'

// ─── Regular user session (for access-control tests) ────────────────────────
const REGULAR_STATE = STORAGE_STATE // e2e-tester@vibesboard.local

// Admin session is created by local-global-setup.ts — no need to re-create it here
let testTenantId: string
let testTenantSlug: string

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
    await ctx.close()
  })

  test('superadmin can access /admin', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_STATE })
    const page = await ctx.newPage()
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page).not.toHaveURL(/^.*\/agents$/)
    await expect(page.locator('body')).toBeVisible()
    await ctx.close()
  })
})

// ─── Admin Dashboard ─────────────────────────────────────────────────────────

test.describe('Admin Dashboard', () => {
  test.use({ storageState: ADMIN_STATE })

  test('admin landing page shows navigation cards', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/sign-in|\/agents$/)
    // Should show links to Tenants, Branding, File Processing
    await expect(
      page.getByText(/tenants/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('admin sidebar shows Tenants, Branding, File Processing links', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/sign-in/)
    // Sidebar has 3 nav links — use .first() since cards also have matching text
    await expect(page.getByRole('link', { name: 'Tenants' }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: 'Branding' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /file processing/i }).first()).toBeVisible()
  })
})

// ─── Tenant Management ───────────────────────────────────────────────────────

test.describe('Admin — Tenant Management', () => {
  test.use({ storageState: ADMIN_STATE })

  test('GET /api/admin/tenants returns tenant list', async ({ request }) => {
    const res = await request.get('/api/admin/tenants')
    // 200 = success; if 401/403, admin session may not be seeded yet
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.tenants ?? body)).toBeTruthy()
    expect((body.tenants ?? body).length).toBeGreaterThan(0)
  })

  test('tenants page loads and shows tenant rows', async ({ page }) => {
    await page.goto('/admin/tenants')
    await expect(page).not.toHaveURL(/sign-in/)
    // Should show at least one tenant row (the e2e-tester personal workspace)
    await expect(
      page.getByText(/e2e-tester|personal/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('can create a new tenant via admin API', async ({ request }) => {
    testTenantSlug = `e2e-admin-tenant-${Date.now()}`
    const res = await request.post('/api/admin/tenants', {
      data: {
        name: 'E2E Admin Test Tenant',
        slug: testTenantSlug,
      },
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    testTenantId = body.tenant?.id ?? body.id
    expect(testTenantId).toBeTruthy()
  })

  test('can update a tenant name and slug via admin API', async ({ request }) => {
    if (!testTenantId) { test.skip(); return }
    const res = await request.put(`/api/admin/tenants/${testTenantId}`, {
      data: { name: 'E2E Admin Tenant (updated)' },
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()
  })

  test('tenant detail page loads with tabs', async ({ page }) => {
    if (!testTenantId) { test.skip(); return }
    await page.goto(`/admin/tenants/${testTenantId}`)
    await expect(page).not.toHaveURL(/sign-in/)
    // Should show Overview tab or tenant detail
    await expect(
      page.getByText(/overview|agents|users|branding|features|usage/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('GET /api/admin/tenants/[id] returns tenant detail', async ({ request }) => {
    if (!testTenantId) { test.skip(); return }
    const res = await request.get(`/api/admin/tenants/${testTenantId}`)
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.tenant?.id ?? body.id).toBeTruthy()
  })

  test('can delete a tenant via admin API', async ({ request }) => {
    if (!testTenantId) { test.skip(); return }
    const res = await request.delete(`/api/admin/tenants/${testTenantId}`, {
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()

    // Verify it's gone
    const check = await request.get(`/api/admin/tenants/${testTenantId}`, { failOnStatusCode: false })
    expect(check.status()).toBe(404)
  })
})

// ─── Platform Branding ────────────────────────────────────────────────────────

test.describe('Admin — Platform Branding', () => {
  test.use({ storageState: ADMIN_STATE })

  test('GET /api/admin/platform-branding returns branding config', async ({ request }) => {
    const res = await request.get('/api/admin/platform-branding')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // Response shape: { branding: { primaryColor, secondaryColor, logoUrl? } }
    // logoUrl may be absent when no logo is set (undefined is stripped by JSON)
    const branding = body.branding ?? body
    expect(branding).toHaveProperty('primaryColor')
    expect(typeof branding.primaryColor).toBe('string')
  })

  test('branding page loads with form fields', async ({ page }) => {
    await page.goto('/admin/branding')
    await expect(page).not.toHaveURL(/sign-in/)
    // Should show branding settings inputs
    await expect(
      page.locator('input[type="text"], input[type="color"], input[type="url"]').first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('can update platform branding via admin API', async ({ request }) => {
    const res = await request.put('/api/admin/platform-branding', {
      data: {
        primaryColor: '#1a2b3c',
        secondaryColor: '#ffffff',
        logoUrl: null,
      },
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()
  })
})

// ─── File Processing Monitor ──────────────────────────────────────────────────

test.describe('Admin — File Processing', () => {
  test.use({ storageState: ADMIN_STATE })

  test('GET /api/admin/files/process returns file status', async ({ request }) => {
    const res = await request.get('/api/admin/files/process')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // Should return files array and status counts
    expect(Array.isArray(body.files ?? body)).toBeTruthy()
  })

  test('files page loads', async ({ page }) => {
    await page.goto('/admin/files')
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
  })
})
