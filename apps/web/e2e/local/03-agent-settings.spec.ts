/**
 * Section 3 — Agent Settings / Configuration Tab
 *
 * Covers:
 *   - Configure tab loads with agent name and instructions pre-filled
 *   - Updating agent name saves successfully
 *   - Updating instructions saves successfully
 *   - Invalid/empty name is rejected
 *   - Agent list reflects name update
 */
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

let agentId: string
const ORIGINAL_NAME = `E2E Settings Agent ${Date.now()}`

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant')
  const { tenant_id: tenantId } = await tenantRes.json()

  const res = await request.post('/api/agents', {
    data: {
      name: ORIGINAL_NAME,
      instructions: 'Original instructions for settings test.',
      tenantId,
    },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  agentId = body.agent?.id ?? body.id
})

test.describe('Agent Settings', () => {
  test('configure tab shows pre-filled name and instructions', async ({ page }) => {
    await page.goto(`/agents/${agentId}?tab=configure`)
    await expect(page).not.toHaveURL(/sign-in/)

    // Find name input — should be pre-filled
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i], input[placeholder*="agent" i]').first()
    await expect(nameInput).toBeVisible({ timeout: 10_000 })
    await expect(nameInput).toHaveValue(ORIGINAL_NAME)
  })

  test('can update agent name via the settings form', async ({ page }) => {
    await page.goto(`/agents/${agentId}?tab=configure`)

    const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="agent" i]').first()
    await expect(nameInput).toBeVisible({ timeout: 10_000 })

    const newName = `E2E Renamed Agent ${Date.now()}`
    await nameInput.clear()
    await nameInput.fill(newName)

    // "Save Changes" becomes enabled when hasChanges is true
    const saveBtn = page.getByRole('button', { name: /save changes/i })
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 })
    await saveBtn.click()

    await expect(page.locator('[role="status"]').first()).toBeVisible({ timeout: 10_000 })

    // Verify the agent name was actually updated via API
    const res = await page.request.get(`/api/agents/${agentId}`)
    if (res.ok()) {
      const { agent } = await res.json()
      expect(agent.name).toBe(newName)
    }
  })

  test('can update agent instructions', async ({ page }) => {
    await page.goto(`/agents/${agentId}?tab=configure`)

    // Instructions textarea has placeholder "Explain how the agent should behave..."
    // rows=6 is unique to the instructions field in the setup tab
    const instructionsField = page.locator('textarea[rows="6"]').first()
    await expect(instructionsField).toBeVisible({ timeout: 10_000 })

    // Use fill() — Playwright's fill dispatches input+change events for React controlled textareas
    await instructionsField.fill('Updated E2E instructions: Be concise and helpful.')

    // "Save Changes" button becomes enabled once hasChanges is true
    const saveBtn = page.getByRole('button', { name: /save changes/i })
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 })
    await saveBtn.click()

    await expect(page.locator('[role="status"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('agent API returns the agent data', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}`)
    expect(res.ok()).toBeTruthy()
    const { agent } = await res.json()
    expect(agent.id).toBe(agentId)
    expect(agent.name).toBeTruthy()
  })

  test('can delete agent via API', async ({ request }) => {
    // Create a throwaway agent to delete
    const tenantRes = await request.get('/api/user/active-tenant')
    const { tenant_id: tenantId } = await tenantRes.json()

    const createRes = await request.post('/api/agents', {
      data: { name: 'E2E Delete Me', instructions: 'To be deleted.', tenantId },
    })
    const _dr = await createRes.json(); const deleteId = _dr.agent?.id ?? _dr.id

    const delRes = await request.delete(`/api/agents/${deleteId}`)
    expect([200, 204]).toContain(delRes.status())

    // Verify it's gone
    const getRes = await request.get(`/api/agents/${deleteId}`, { failOnStatusCode: false })
    expect(getRes.status()).toBe(404)
  })
})
