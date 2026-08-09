/**
 * Section 2 — Agent Chat (owner-facing "Ask AI")
 *
 * Covers:
 *   - POST /api/agents/[id]/conversations/ask returns 200, streams the stubbed
 *     model text, and sets the `x-session-id` header the client needs
 *   - Replaying that session id appends to the SAME conversation (no fork) and
 *     the turns are persisted in order
 *   - Invalid input is rejected with 400 (empty question, over-length question,
 *     malformed JSON) and an unknown agent id is 404 — not a blanket ">= 400"
 *   - The agent page renders the Ask AI composer
 *   - Sending a message renders a reply produced by *that* turn (the count goes
 *     0 -> 1 on a freshly created agent, so stored history cannot satisfy it)
 *     and the turn is persisted to the conversation
 *   - The composer clears only once a request carrying the text has gone out
 *   - Empty / whitespace-only input cannot be submitted
 *   - ?tab=configure resolves to the Setup tab and renders this agent's config
 *
 * Every agent used here is created by this file and deleted in afterAll, so no
 * test depends on another having run, on leftovers from a previous run, or on
 * whatever agent happened to be newest in the workspace.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'
const AGENT_INSTRUCTIONS = 'You are a concise E2E test agent. Keep answers brief.'

test.use({ storageState: STORAGE_STATE })

const askUrl = (agentId: string) => `/api/agents/${agentId}/conversations/ask`

/**
 * The chat surface only. app/layout.tsx renders an outer <main> and
 * components/layouts/dashboard-layout.tsx renders a nested one around the chat,
 * so the last <main> is the message area and excludes both sidebars — the
 * persistent sidebar (components/sidebar-list.tsx) renders conversation
 * previews for other agents and must not be able to satisfy these assertions.
 */
const chatArea = (page: Page) => page.locator('main').last()

/** Fill a react-textarea-autosize controlled input via the native value setter. */
async function fillChatInput(page: Page, text: string) {
  await page.locator('[data-testid="chat-input"]').click()
  await page.evaluate((value) => {
    const el = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

// Everything this file creates, torn down in afterAll.
const createdAgentIds: string[] = []

/**
 * Create a dedicated agent. A fresh agent has no conversation history, which is
 * what makes the "reply count went 0 -> 1" assertions below meaningful.
 */
async function createAgent(
  request: APIRequestContext,
  label: string
): Promise<{ id: string; name: string }> {
  const name = `E2E Chat ${label} ${Date.now()}-${Math.floor(Math.random() * 100_000)}`
  const res = await request.post('/api/agents', {
    // instructions must be >= 10 chars (upsertAgentSchema)
    data: { name, instructions: AGENT_INSTRUCTIONS },
  })
  expect(res.status(), `POST /api/agents: ${await res.text()}`).toBe(200)
  const body = await res.json()
  // app/api/agents/route.ts responds with { agent }. Assert the shape here so a
  // change fails loudly instead of degrading later calls into
  // /api/agents/undefined/... (which would still "pass" a >= 400 assertion).
  expect(body.agent?.id, 'POST /api/agents must return { agent: { id } }').toBeTruthy()
  createdAgentIds.push(body.agent.id)
  return { id: body.agent.id as string, name }
}

/**
 * Read a conversation back through the API as `role: content` lines, or null
 * when it is not there yet — the ask route persists from streamText's onFinish,
 * which can land just after the HTTP response closes, so callers poll on this.
 */
async function conversationMessages(
  request: APIRequestContext,
  agentId: string,
  conversationId: string
): Promise<string[] | null> {
  const res = await request.get(`/api/agents/${agentId}/conversations`, {
    failOnStatusCode: false,
  })
  if (!res.ok()) return null
  const { conversations } = await res.json()
  const conversation = conversations?.find(
    (c: { id: string }) => c.id === conversationId
  )
  if (!conversation) return null
  return (conversation.messages ?? []).map(
    (m: { role: string; content: string }) => `${m.role}: ${m.content}`
  )
}

test.afterAll(async ({ request }) => {
  for (const id of createdAgentIds.splice(0)) {
    const res = await request.delete(`/api/agents/${id}`, { failOnStatusCode: false })
    expect([204, 404]).toContain(res.status())
  }
})

test.describe('Agent Chat — API', () => {
  // Shared by the tests that only need *an* agent they own. The continuity test
  // creates its own, because it asserts on the exact conversation count.
  let agentId: string

  test.beforeAll(async ({ request }) => {
    agentId = (await createAgent(request, 'api')).id
  })

  test('conversations/ask streams the stubbed reply and returns x-session-id', async ({
    request,
  }) => {
    const res = await request.post(askUrl(agentId), {
      data: { question: 'Hello from E2E' },
    })

    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/plain')
    // The client reads this header in agent-ask-chat.tsx onResponse and replays
    // it as `sessionId` on the next turn; without it every follow-up forks a
    // brand-new conversation.
    expect(res.headers()['x-session-id']).toBeTruthy()
    expect(await res.text()).toContain(STUB_REPLY)
  })

  test('a follow-up carrying the session id appends to the same conversation', async ({
    request,
  }) => {
    const { id } = await createAgent(request, 'api-session')

    const first = await request.post(askUrl(id), { data: { question: 'First turn' } })
    expect(first.status()).toBe(200)
    const sessionId = first.headers()['x-session-id']
    expect(sessionId).toBeTruthy()
    expect(await first.text()).toContain(STUB_REPLY)

    // Wait for the first turn to be persisted before asking again — the second
    // request builds its history from what is already stored.
    await expect
      .poll(() => conversationMessages(request, id, sessionId), { timeout: 20_000 })
      .toEqual([`user: First turn`, `assistant: ${STUB_REPLY}`])

    const second = await request.post(askUrl(id), {
      data: { question: 'Second turn', sessionId },
    })
    expect(second.status()).toBe(200)
    expect(second.headers()['x-session-id']).toBe(sessionId)
    expect(await second.text()).toContain(STUB_REPLY)

    await expect
      .poll(() => conversationMessages(request, id, sessionId), { timeout: 20_000 })
      .toEqual([
        `user: First turn`,
        `assistant: ${STUB_REPLY}`,
        `user: Second turn`,
        `assistant: ${STUB_REPLY}`,
      ])

    // ...and the follow-up did not quietly start a second conversation.
    const listRes = await request.get(`/api/agents/${id}/conversations`)
    expect(listRes.status()).toBe(200)
    const { conversations } = await listRes.json()
    expect(conversations).toHaveLength(1)
    expect(conversations[0].id).toBe(sessionId)
  })

  test('conversations/ask rejects an empty question with 400', async ({ request }) => {
    const res = await request.post(askUrl(agentId), {
      data: { question: '' },
      failOnStatusCode: false,
    })

    // 400 specifically: a 401/403/404/429 here would mean the request never
    // reached validation, and a 500 would mean the ZodError escaped the handler.
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid input')
    expect(
      (body.issues ?? []).some((issue: { path?: unknown[] }) =>
        issue.path?.includes('question')
      ),
      'the 400 must be a validation failure on `question`'
    ).toBe(true)
  })

  test('conversations/ask rejects a question over the 2000-character limit with 400', async ({
    request,
  }) => {
    const res = await request.post(askUrl(agentId), {
      data: { question: 'x'.repeat(2_001) },
      failOnStatusCode: false,
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid input')
  })

  test('conversations/ask rejects a malformed JSON body with 400', async ({ request }) => {
    const res = await request.post(askUrl(agentId), {
      // Buffer, not string: Playwright JSON-encodes a string `data` when the
      // content type is application/json, which would make the body *valid*
      // JSON (a string) and take the schema-validation path instead of the
      // JSON-parse path this test is about.
      data: Buffer.from('{"question": '),
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    })

    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
  })

  test('conversations/ask returns 404 for an agent that does not exist', async ({
    request,
  }) => {
    const res = await request.post(askUrl('00000000-0000-4000-8000-000000000000'), {
      data: { question: 'Hello from E2E' },
      failOnStatusCode: false,
    })

    expect(res.status()).toBe(404)
    expect(await res.text()).toContain('Agent not found')
  })
})

test.describe('Agent Chat — UI', () => {
  // A pristine agent for the tests that never send a message, so they cannot
  // affect each other and none of them depends on execution order.
  let readOnlyAgent: { id: string; name: string }

  test.beforeAll(async ({ request }) => {
    readOnlyAgent = await createAgent(request, 'ui')
  })

  test('agent page renders the Ask AI composer', async ({ page }) => {
    await page.goto(`/agents/${readOnlyAgent.id}`)
    await expect(page).not.toHaveURL(/sign-in/)

    // Rendered only by components/agents/agent-ask-chat.tsx (empty state), not
    // by the shared dashboard layout.
    await expect(page.getByRole('heading', { name: 'ASK AI' })).toBeVisible({
      timeout: 15_000,
    })
    const input = page.getByTestId('chat-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute(
      'placeholder',
      /Ask about your visitor conversations/
    )
    await expect(input).toHaveValue('')
  })

  test('sending a message renders the reply from that turn and persists it', async ({
    page,
    request,
  }) => {
    const { id } = await createAgent(request, 'ui-send')
    await page.goto(`/agents/${id}`)
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })

    // A brand-new agent has no conversations, so nothing is seeded into the
    // message list. This is what makes the post-send count meaningful: the
    // reply below can only have come from the turn this test sends.
    await expect(chatArea(page).getByText(STUB_REPLY)).toHaveCount(0)

    const question = `What can you help me with? ${Date.now()}`
    await fillChatInput(page, question)

    const sendBtn = page.getByRole('button', { name: /send message/i })
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 })

    const responsePromise = page.waitForResponse(
      r => r.url().includes(askUrl(id)) && r.request().method() === 'POST',
      { timeout: 30_000 }
    )
    await sendBtn.click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const sessionId = response.headers()['x-session-id']
    expect(sessionId).toBeTruthy()

    // The streamed text has to make it through useCompletion -> pending merge
    // -> onFinish -> ChatList for these counts to move.
    await expect(chatArea(page).getByText(question)).toHaveCount(1)
    await expect(chatArea(page).getByText(STUB_REPLY)).toHaveCount(1, {
      timeout: 15_000,
    })

    // ...in that order: question first, then the answer.
    const transcript = await chatArea(page).innerText()
    expect(transcript).toContain(question)
    expect(transcript.indexOf(question)).toBeLessThan(transcript.indexOf(STUB_REPLY))

    // ...and the turn was written to the conversation the header pointed at.
    await expect
      .poll(() => conversationMessages(request, id, sessionId), { timeout: 20_000 })
      .toEqual([`user: ${question}`, `assistant: ${STUB_REPLY}`])
  })

  test('the composer clears only once the request carrying the text goes out', async ({
    page,
    request,
  }) => {
    const { id } = await createAgent(request, 'ui-clear')
    await page.goto(`/agents/${id}`)
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })

    const message = `Clear me after send ${Date.now()}`
    await fillChatInput(page, message)

    const sendBtn = page.getByRole('button', { name: /send message/i })
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 })

    const responsePromise = page.waitForResponse(
      r => r.url().includes(askUrl(id)) && r.request().method() === 'POST',
      { timeout: 30_000 }
    )
    await sendBtn.click()

    // prompt-form.tsx clears the field synchronously, before awaiting onSubmit,
    // so this alone proves nothing — it is only meaningful paired with the
    // request assertions below.
    await expect(page.getByTestId('chat-input')).toHaveValue('', { timeout: 3_000 })

    const response = await responsePromise
    expect(response.status()).toBe(200)
    // The text that vanished from the box is the text that was sent. The ask
    // route accepts either key (question, falling back to prompt).
    const sent = response.request().postDataJSON()
    expect(sent?.question ?? sent?.prompt).toBe(message)
    await expect(chatArea(page).getByText(STUB_REPLY)).toHaveCount(1, {
      timeout: 15_000,
    })
  })

  test('empty and whitespace-only input cannot be submitted', async ({ page }) => {
    await page.goto(`/agents/${readOnlyAgent.id}`)
    const input = page.getByTestId('chat-input')
    await expect(input).toBeVisible({ timeout: 15_000 })

    const askRequests: string[] = []
    page.on('request', r => {
      if (r.url().includes('/conversations/ask')) askRequests.push(r.url())
    })

    const sendBtn = page.getByRole('button', { name: /send message/i })
    await expect(sendBtn).toBeDisabled()

    await fillChatInput(page, '   ')
    await expect(sendBtn).toBeDisabled()

    // Enter submits the form (lib/hooks/use-enter-submit.tsx); the trim guard in
    // prompt-form.tsx must stop it before any request is made.
    await input.press('Enter')
    await page.waitForTimeout(1_000)

    expect(askRequests).toEqual([])
    await expect(input).toHaveValue('   ')
    // Still the empty state — no user bubble was appended.
    await expect(page.getByRole('heading', { name: 'ASK AI' })).toBeVisible()
    await expect(chatArea(page).getByText(STUB_REPLY)).toHaveCount(0)
  })

  test('?tab=configure opens the Setup tab for this agent', async ({ page }) => {
    await page.goto(`/agents/${readOnlyAgent.id}?tab=configure`)
    await expect(page).not.toHaveURL(/sign-in/)

    const setupTab = page.getByRole('tab', { name: /^setup$/i })
    await expect(setupTab).toBeVisible({ timeout: 20_000 })
    // `configure` is a legacy alias resolved to `setup` in
    // components/agents/agent-dashboard-tabs.tsx.
    await expect(setupTab).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('tab', { name: /^knowledge$/i })).toBeVisible()

    // The Setup panel is showing *this* agent's configuration, not an empty shell.
    await expect(page.getByPlaceholder('Agent name')).toHaveValue(readOnlyAgent.name)
    await expect(
      page.getByPlaceholder(/Explain how the agent should behave/i)
    ).toHaveValue(AGENT_INSTRUCTIONS)

    // The Ask AI composer is replaced by the dashboard, so a stale chat textarea
    // can no longer stand in for a rendered Setup panel.
    await expect(page.getByTestId('chat-input')).toHaveCount(0)
  })
})
