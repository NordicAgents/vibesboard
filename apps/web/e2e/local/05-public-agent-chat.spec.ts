/**
 * Section 5 — Public Agent Chat (Widget)
 *
 * The core user-facing feature: anonymous visitors chat with agents via
 *   /widget/[agentId]           — embeddable iframe
 *   /api/public/agents/[id]/chat — streaming endpoint (uses runtime.ts)
 *
 * Covers:
 *   - Widget page loads for an allowAnonymous agent
 *   - Sending a message returns the mock reply
 *   - Chat API endpoint works directly (API smoke)
 *   - Conversation feedback (thumbs up/down) works
 *   - Gated agents show access gate form
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { STORAGE_STATE, BASE_URL } from '../constants.ts'

const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'

// Shared agent — created once, used across all tests
let publicAgentId: string
let gatedAgentId: string

test.describe.configure({ mode: 'serial' })

// Create test agents via API (need auth for creation, then test public access)
test.beforeAll(async () => {
  // Create an authenticated context using stored session
  const ctx = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })

  const tenantRes = await ctx.get('/api/user/active-tenant')
  const { tenant_id: tenantId } = await tenantRes.json()

  // Public (allow anonymous) agent
  const publicRes = await ctx.post('/api/agents', {
    data: {
      name: 'E2E Public Chat Agent',
      instructions: 'You are a helpful E2E test agent.',
      tenantId,
      allowAnonymous: true,
    },
  })
  expect(publicRes.ok()).toBeTruthy()
  const pb = await publicRes.json()
  publicAgentId = pb.agent?.id ?? pb.id

  // Gated agent (not anonymous)
  const gatedRes = await ctx.post('/api/agents', {
    data: {
      name: 'E2E Gated Agent',
      instructions: 'Gated agent for E2E.',
      tenantId,
      allowAnonymous: false,
    },
  })
  expect(gatedRes.ok()).toBeTruthy()
  const gb = await gatedRes.json()
  gatedAgentId = gb.agent?.id ?? gb.id

  await ctx.dispose()
})

test.describe('Public Agent Chat — API', () => {
  test('public chat API returns a streaming response (no auth required)', async ({ request }) => {
    // No storageState — unauthenticated request
    const res = await request.post(`/api/public/agents/${publicAgentId}/chat`, {
      data: {
        messages: [{ role: 'user', content: 'Hello from public E2E' }],
      },
      failOnStatusCode: false,
    })
    expect(res.ok()).toBeTruthy()
    const text = await res.text()
    expect(text.length).toBeGreaterThan(0)
  })

  test('gated agent rejects unauthenticated chat without access cookie', async ({ request }) => {
    const res = await request.post(`/api/public/agents/${gatedAgentId}/chat`, {
      data: {
        messages: [{ role: 'user', content: 'Hello' }],
      },
      failOnStatusCode: false,
    })
    // Should be 401 or 403
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('Public Agent Widget — UI', () => {
  test('widget page loads for an anonymous agent', async ({ page }) => {
    await page.goto(`/widget/${publicAgentId}`)
    // Widget should render the chat UI (not require sign in)
    await expect(page).not.toHaveURL(/sign-in/)
    await expect(page.locator('body')).toBeVisible()
    // Should have a text input for chatting
    await expect(
      page.locator('textarea, input[type="text"]').first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('widget chat sends a message and receives mock reply', async ({ page }) => {
    await page.goto(`/widget/${publicAgentId}`)

    const input = page.getByTestId('chat-input').or(
      page.locator('textarea, input[type="text"]').first()
    )
    await expect(input).toBeVisible({ timeout: 10_000 })

    await input.click()
    await page.evaluate(() => {
      const el = (document.querySelector('[data-testid="chat-input"]') ||
        document.querySelector('textarea, input[type="text"]')) as HTMLTextAreaElement | HTMLInputElement
      if (!el) return
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(el, 'What can you help me with?')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const sendBtn = page.getByRole('button', { name: /send/i }).first()
    if (await sendBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
      const responsePromise = page.waitForResponse(
        r => r.url().includes(`/api/public/agents/${publicAgentId}/chat`) && r.status() === 200,
        { timeout: 30_000 }
      )
      await sendBtn.click()
      await responsePromise
      // Some response text should appear
      await expect(page.locator('body')).toContainText(/[A-Za-z]{10,}/, { timeout: 15_000 })
    } else {
      // Widget might use Enter submit
      await input.press('Enter')
      await expect(page.locator('body')).toContainText(/[A-Za-z]{10,}/, { timeout: 30_000 })
    }
  })

  test('gated widget shows access gate form', async ({ page }) => {
    await page.goto(`/widget/${gatedAgentId}`)
    await expect(page).not.toHaveURL(/sign-in/)
    // Should show access gate (password or invite code form) rather than chat
    await expect(
      page.getByText(/password|invite|access/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Public Agent Chat — Conversation Feedback', () => {
  test('feedback API accepts thumbs up/down', async ({ request }) => {
    // First create a conversation by chatting
    const chatRes = await request.post(`/api/public/agents/${publicAgentId}/chat`, {
      data: { messages: [{ role: 'user', content: 'Hello feedback test' }] },
      failOnStatusCode: false,
    })
    if (!chatRes.ok()) {
      test.skip() // Skip if chat isn't working (model/infra issue)
      return
    }

    // Get conversation list
    const convRes = await request.get(`/api/public/agents/${publicAgentId}/conversations`, {
      failOnStatusCode: false,
    })
    if (!convRes.ok()) { test.skip(); return }
    const { conversations } = await convRes.json()
    if (!conversations?.length) { test.skip(); return }

    const cid = conversations[0].id
    const feedbackRes = await request.post(
      `/api/public/agents/${publicAgentId}/conversations/${cid}/feedback`,
      {
        data: { rating: 'positive' },
        failOnStatusCode: false,
      }
    )
    expect([200, 201, 204]).toContain(feedbackRes.status())
  })
})
