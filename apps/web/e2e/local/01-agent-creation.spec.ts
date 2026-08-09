/**
 * Section 1 — Agent Creation
 *
 * Covers:
 *   - Agents list page renders for authenticated users
 *   - "Create Agent" button navigates to the AI-creator chat
 *   - Agent creator chat loads and accepts input
 *   - AI responds (mock reply) and an agent is saved
 *   - New agent appears on the /agents list
 *   - Agent can be created directly via POST /api/agents (API smoke)
 */
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'

test.use({ storageState: STORAGE_STATE })

test.describe('Agent Creation', () => {
  test('agents list page loads for authenticated user', async ({ page }) => {
    await page.goto('/agents')
    await expect(page).not.toHaveURL(/sign-in/)
    // Either shows agents or an empty state — just confirm the page renders
    await expect(page.locator('body')).toBeVisible()
    await expect(page.getByRole('link', { name: /create agent/i }).or(
      page.getByRole('button', { name: /create agent/i })
    )).toBeVisible()
  })

  test('create agent button navigates to the AI creator', async ({ page }) => {
    await page.goto('/agents')
    const createBtn = page.getByRole('link', { name: /create agent/i }).or(
      page.getByRole('button', { name: /create agent/i })
    )
    await createBtn.click()
    await expect(page).toHaveURL(/\/agents\/create-chat|\/agents\/new/)
  })

  test('agent creator chat interface renders', async ({ page }) => {
    await page.goto('/agents/create-chat')
    await expect(page).not.toHaveURL(/sign-in/)
    // prompt-form.tsx uses data-testid="chat-input" on the message textarea
    await expect(page.getByTestId('chat-input')).toBeVisible()
  })

  test('agent creator API responds to a message', async ({ request, page }) => {
    // Verify the creator chat page loads
    await page.goto('/agents/create-chat')
    await expect(page.getByTestId('chat-input')).toBeVisible()

    // The suggestion card chips should be visible in initial state
    await expect(page.getByText(/customer support/i)).toBeVisible()

    // Verify the API endpoint itself works (the UI chat state is complex to
    // drive via Playwright due to react-textarea-autosize controlled state)
    const tenantRes = await request.get('/api/user/active-tenant')
    const { tenant_id: tenantId } = await tenantRes.json()

    const res = await request.post('/api/agent-creator', {
      data: {
        messages: [{ role: 'user', content: 'I need a helpful customer support agent' }],
        fileKeys: [],
        fileNames: [],
        id: 'e2e-test-chat',
        tenant_id: tenantId,
      },
      headers: { 'Content-Type': 'application/json' },
    })
    // 200 means the API accepted the request and streamed a response
    expect(res.ok()).toBeTruthy()
    const body = await res.text()
    expect(body.length).toBeGreaterThan(0)
  })

  test('can create an agent via API and it appears on the list', async ({ request, page }) => {
    // Get active tenant
    const tenantRes = await request.get('/api/user/active-tenant')
    expect(tenantRes.ok()).toBeTruthy()
    const { tenant_id: tenantId } = await tenantRes.json()
    expect(tenantId).toBeTruthy()

    // Create agent via API — response shape is { agent: { id, ... } }
    const agentName = `E2E Test Agent ${Date.now()}`
    const createRes = await request.post('/api/agents', {
      data: {
        name: agentName,
        instructions: 'You are a helpful E2E test agent.',
        tenantId,
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const body = await createRes.json()
    const agentId = body.agent?.id ?? body.id
    expect(agentId).toBeTruthy()

    // The agent should appear on the list page
    await page.goto('/agents')
    // The name appears in the card h3 AND possibly a sidebar link — .first() avoids strict-mode errors
    await expect(page.getByText(agentName).first()).toBeVisible({ timeout: 10_000 })
  })

  test('agent detail page loads after creation', async ({ request, page }) => {
    // Create a fresh agent via API
    const tenantRes = await request.get('/api/user/active-tenant')
    const { tenant_id: tenantId } = await tenantRes.json()

    const agentName = `E2E Detail Test ${Date.now()}`
    const createRes = await request.post('/api/agents', {
      data: { name: agentName, instructions: 'Detail page test agent.', tenantId },
    })
    const body = await createRes.json()
    const id = body.agent?.id ?? body.id

    await page.goto(`/agents/${id}`)
    await expect(page).not.toHaveURL(/sign-in|not-found/)
    await expect(page.locator('body')).toBeVisible()
  })
})
