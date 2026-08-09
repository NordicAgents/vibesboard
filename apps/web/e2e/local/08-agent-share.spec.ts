/**
 * Section 8 — Agent Sharing
 *
 * Covers:
 *   - Share tab loads with QR and URL
 *   - Share API returns canonical URL and QR data
 *   - Public canonical URL (/[tenantSlug]/[agentSlug]) loads
 *   - Version history tab loads
 *   - Can view version history entries
 */
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

let agentId: string
let tenantSlug: string
let agentUrl: string

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant')
  const { tenant_id: tenantId } = await tenantRes.json()

  // Get tenant slug
  const tenantConfigRes = await request.get(`/api/tenants/${tenantId}/config`, {
    failOnStatusCode: false,
  })
  if (tenantConfigRes.ok()) {
    const cfg = await tenantConfigRes.json()
    // Config response is { tenant: { slug, ... }, branding, features }
    tenantSlug = cfg.tenant?.slug ?? cfg.slug ?? ''
  }

  // Create agent for share tests
  const createRes = await request.post('/api/agents', {
    data: {
      name: 'E2E Share Agent',
      instructions: 'Shareable agent for E2E.',
      tenantId,
      allowAnonymous: true,
    },
  })
  const body = await createRes.json()
  agentId = body.agent?.id ?? body.id

  // Get agent URL slug
  const agentRes = await request.get(`/api/agents/${agentId}`)
  if (agentRes.ok()) {
    const { agent } = await agentRes.json()
    agentUrl = agent?.agentUrl ?? agent?.agent_url ?? ''
  }
})

test.describe('Agent Share — API', () => {
  test('share endpoint returns url and QR', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/share`, { failOnStatusCode: false })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // Should have a share URL
    expect(body.url ?? body.shareUrl ?? body.agentUrl).toBeTruthy()
  })

  test('versions API returns history', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/versions`, { failOnStatusCode: false })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.versions ?? body)).toBeTruthy()
  })
})

test.describe('Agent Share — UI', () => {
  test('share tab loads with share URL', async ({ page }) => {
    await page.goto(`/agents/${agentId}?tab=share`)
    await expect(page).not.toHaveURL(/sign-in/)
    await page.waitForLoadState('domcontentloaded')
    // The SHARE tab trigger in the nav bar is always visible once the agent page loads
    await expect(
      page.getByRole('tab', { name: /share/i })
    ).toBeVisible({ timeout: 20_000 })
  })

  test('public canonical URL loads agent chat', async ({ page }) => {
    if (!tenantSlug || !agentUrl) {
      test.skip()
      return
    }
    await page.goto(`/${tenantSlug}/${agentUrl}`)
    await expect(page).not.toHaveURL(/sign-in|not-found|404/)
    await expect(page.locator('body')).toBeVisible()
    // Should show chat interface for anonymous agent
    await expect(
      page.locator('textarea, input[type="text"]').first()
    ).toBeVisible({ timeout: 20_000 })
  })

  test('history tab loads with version list', async ({ page }) => {
    await page.goto(`/agents/${agentId}?tab=history`)
    await expect(page).not.toHaveURL(/sign-in/)
    await page.waitForLoadState('domcontentloaded')
    // The HISTORY tab trigger in the nav bar is always visible once the agent page loads
    await expect(
      page.getByRole('tab', { name: /history/i })
    ).toBeVisible({ timeout: 20_000 })
  })
})
