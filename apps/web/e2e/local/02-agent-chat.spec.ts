/**
 * Section 2 — Agent Chat
 *
 * Covers:
 *   - Agent chat page loads
 *   - Sending a message via the chat UI receives a mock reply
 *   - Sending a message via the chat API returns a stream
 *   - Empty message is rejected (no submit)
 *   - Chat textarea clears after sending
 */
import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'

test.use({ storageState: STORAGE_STATE })

/** Fill a react-textarea-autosize controlled input via the native value setter. */
async function fillChatInput(page: import('@playwright/test').Page, text: string) {
  await page.locator('[data-testid="chat-input"]').click()
  await page.evaluate((value) => {
    const el = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

// Shared agent created once for this section
let agentId: string

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant')
  expect(tenantRes.ok()).toBeTruthy()
  const { tenant_id: tenantId } = await tenantRes.json()

  // Try to reuse existing agent if possible, otherwise create one
  const listRes = await request.get('/api/agents?limit=1')
  if (listRes.ok()) {
    const { agents } = await listRes.json()
    if (agents?.length) {
      agentId = agents[0].id
      return
    }
  }

  const createRes = await request.post('/api/agents', {
    data: {
      name: 'E2E Chat Test Agent',
      instructions: 'You are a concise E2E test agent. Keep answers brief.',
      tenantId,
    },
  })
  expect(createRes.ok()).toBeTruthy()
  const _cr = await createRes.json()
  agentId = _cr.agent?.id ?? _cr.id
})

test.describe('Agent Chat — API', () => {
  test('conversations/ask API returns a streaming response', async ({ request }) => {
    // The owner-facing ask endpoint uses { question: string }
    const res = await request.post(`/api/agents/${agentId}/conversations/ask`, {
      data: { question: 'Hello from E2E' },
    })
    expect(res.ok()).toBeTruthy()
    const text = await res.text()
    expect(text.length).toBeGreaterThan(0)
    // The response body includes the streamed text content
    expect(text.length).toBeGreaterThan(10)
  })

  test('conversations/ask rejects empty question', async ({ request }) => {
    const res = await request.post(`/api/agents/${agentId}/conversations/ask`, {
      data: { question: '' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('Agent Chat — UI', () => {
  test('agent page loads with the chat input visible', async ({ page }) => {
    await page.goto(`/agents/${agentId}`)
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })
  })

  test('sending a message shows the mock reply', async ({ page }) => {
    await page.goto(`/agents/${agentId}`)

    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })
    await fillChatInput(page, 'What can you help me with?')

    const sendBtn = page.getByRole('button', { name: /send message/i })
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 })

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/conversations/ask') && r.status() === 200,
      { timeout: 30_000 }
    )
    await sendBtn.click()
    await responsePromise

    // Multiple prior runs may have accumulated instances — .first() avoids strict-mode violation
    await expect(page.getByText(STUB_REPLY).first()).toBeVisible({ timeout: 15_000 })
  })

  test('user message appears in the chat immediately', async ({ page }) => {
    await page.goto(`/agents/${agentId}`)
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })

    const message = 'Unique E2E test message ' + Date.now()
    await fillChatInput(page, message)

    const sendBtn = page.getByRole('button', { name: /send message/i })
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 })
    await sendBtn.click()

    // User message should appear quickly (before the API even responds)
    await expect(page.getByText(message)).toBeVisible({ timeout: 5_000 })
  })

  test('chat input is cleared after sending', async ({ page }) => {
    await page.goto(`/agents/${agentId}`)
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })

    await fillChatInput(page, 'Clear me after send')

    const sendBtn = page.getByRole('button', { name: /send message/i })
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 })
    await sendBtn.click()

    // Input should clear immediately after submit
    await expect(page.getByTestId('chat-input')).toHaveValue('', { timeout: 3_000 })
  })

  test('configure tab is accessible', async ({ page }) => {
    await page.goto(`/agents/${agentId}?tab=configure`)
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('input, textarea').first()).toBeVisible({ timeout: 10_000 })
  })
})
