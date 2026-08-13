/**
 * Section 6 — Conversations
 *
 * Covers owner-side conversation management, end to end:
 *   - A visitor chats through the public endpoint → the owner's list, the
 *     single-conversation fetch and the agent page all surface that row
 *   - Owner can close a conversation (summary + closedAt are persisted)
 *   - A non-member cannot close it
 *   - Owner's Ask AI (conversations/ask) streams the stubbed reply, returns the
 *     conversation id in `x-session-id`, threads a follow-up onto the same
 *     conversation and persists every turn
 *
 * Fixtures are seeded through the real APIs in beforeAll and every seed is
 * asserted, so a broken seed fails loudly instead of turning the tests below
 * into silent skips. Cross-tenant *read* authorization for these routes is
 * covered by 12-tenant-isolation.spec.ts and deliberately not repeated here.
 */
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { BASE_URL, OUTSIDER_STATE, STORAGE_STATE } from '../constants.ts'

// The deterministic reply from e2e/mock-openai.mjs — every model call in this
// suite resolves to it, so it is an assertable value, not decoration.
const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'

// One stamp per run keeps the seeded text unique, so assertions can never be
// satisfied by a leftover conversation from an earlier run.
const STAMP = Date.now()
const VISITOR_MESSAGE = `Hello from E2E visitor ${STAMP}`
const CLOSABLE_MESSAGE = `Closable E2E visitor chat ${STAMP}`

// A syntactically valid uuid that no conversation uses (the column is uuid, so
// a non-uuid string would fail in the driver rather than in the handler).
const MISSING_CONVERSATION_ID = '00000000-0000-4000-8000-000000000000'

type PersistedMessage = { id: string; role: string; content: string }
type PersistedConversation = {
  id: string
  agentId: string
  userId: string | null
  externalId: string | null
  summary: string | null
  closedAt: string | null
  messages: PersistedMessage[]
}

test.use({ storageState: STORAGE_STATE })

let agentId: string
// A visitor conversation kept pristine: the list / fetch / UI tests assert on
// it, so nothing in this file is allowed to mutate it.
let visitorConversationId: string
// A second visitor conversation used by the close tests, so closing it (which
// writes a summary and therefore changes the sidebar preview) cannot affect the
// assertions above.
let closableConversationId: string

/** Fill the react-textarea-autosize controlled input via the native value setter. */
async function fillChatInput(page: Page, text: string) {
  await page.getByTestId('chat-input').click()
  await page.evaluate((value) => {
    const el = document.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

/**
 * Number of persisted messages on a conversation, or -1 when it cannot be read.
 * Ask AI saves the assistant turn *after* the stream closes, so the read side
 * has to be polled rather than sampled once.
 */
async function conversationMessageCount(
  request: APIRequestContext,
  conversationId: string,
): Promise<number> {
  const res = await request.get(
    `/api/agents/${agentId}/conversations/${conversationId}`,
    { failOnStatusCode: false },
  )
  if (res.status() !== 200) return -1
  const { conversation } = (await res.json()) as {
    conversation: PersistedConversation
  }
  return conversation.messages.length
}

/**
 * Drive one public (visitor) chat turn from a FRESH anonymous context so each
 * call gets its own `va_ext` cookie — and therefore its own conversation row
 * (app/api/public/agents/[agentId]/chat/route.ts resolves the conversation by
 * that cookie). Returns the id the route reports in `x-conversation-id`.
 */
async function seedVisitorConversation(content: string): Promise<string> {
  const visitor = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: undefined })
  try {
    const res = await visitor.post(`/api/public/agents/${agentId}/chat`, {
      data: { messages: [{ role: 'user', content }] },
      failOnStatusCode: false,
    })
    // Draining the stream also lets the server-side onCompletion persistence run.
    const body = await res.text()
    expect(res.status(), `public chat failed: ${body}`).toBe(200)
    expect(body).toContain(STUB_REPLY)

    const conversationId = res.headers()['x-conversation-id']
    expect(
      conversationId,
      'public chat must report the conversation id in x-conversation-id',
    ).toBeTruthy()
    return conversationId
  } finally {
    await visitor.dispose()
  }
}

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant', {
    failOnStatusCode: false,
  })
  expect(tenantRes.status()).toBe(200)
  const { tenant_id: tenantId } = await tenantRes.json()
  expect(tenantId).toBeTruthy()

  const createRes = await request.post('/api/agents', {
    data: {
      name: `E2E Conversations Agent ${STAMP}`,
      instructions: 'You are a helpful agent for the E2E conversations suite.',
      tenantId,
      allowAnonymous: true,
    },
    failOnStatusCode: false,
  })
  const createdRaw = await createRes.text()
  expect(createRes.status(), createdRaw).toBe(200)
  agentId = JSON.parse(createdRaw).agent?.id
  expect(agentId, 'agent creation must return an id').toBeTruthy()

  visitorConversationId = await seedVisitorConversation(VISITOR_MESSAGE)
  closableConversationId = await seedVisitorConversation(CLOSABLE_MESSAGE)
  expect(
    visitorConversationId,
    'each visitor context must get its own conversation',
  ).not.toBe(closableConversationId)
})

test.afterAll(async ({ request }) => {
  if (agentId) {
    await request.delete(`/api/agents/${agentId}`, { failOnStatusCode: false })
  }
})

test.describe('Conversations — API', () => {
  test('the conversations list contains the seeded visitor conversation', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/conversations`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)

    const { conversations } = (await res.json()) as {
      conversations: PersistedConversation[]
    }
    expect(Array.isArray(conversations)).toBe(true)

    // An empty array used to satisfy this test — require the seeded row itself.
    const seeded = conversations.find(c => c.id === visitorConversationId)
    expect(
      seeded,
      `seeded visitor conversation ${visitorConversationId} is missing from the list`,
    ).toBeTruthy()

    // externalId set + no owner user is exactly the "visitor" marker the agent
    // page filters on (app/agents/[id]/page.tsx:68-70).
    expect(typeof seeded!.externalId).toBe('string')
    expect(seeded!.externalId!.length).toBeGreaterThan(0)
    expect(seeded!.userId).toBeNull()
    expect(seeded!.messages.map(m => m.content)).toContain(VISITOR_MESSAGE)
  })

  test('a conversation from the list can be fetched by id', async ({
    request,
  }) => {
    const res = await request.get(
      `/api/agents/${agentId}/conversations/${visitorConversationId}`,
      { failOnStatusCode: false },
    )
    // 404 is unreachable for an id the list just returned: both routes resolve
    // the row through the same (tenantId, agentId) pair.
    expect(res.status()).toBe(200)

    const { conversation } = (await res.json()) as {
      conversation: PersistedConversation
    }
    expect(conversation.id).toBe(visitorConversationId)
    expect(conversation.agentId).toBe(agentId)
    expect(conversation.messages.length).toBeGreaterThan(0)
    expect(conversation.messages[0].role).toBe('user')
    expect(conversation.messages[0].content).toBe(VISITOR_MESSAGE)
  })

  test('an unknown conversation id returns 404', async ({ request }) => {
    // Proves the 200 above is a real resolution rather than a route that
    // answers 200 for anything.
    const res = await request.get(
      `/api/agents/${agentId}/conversations/${MISSING_CONVERSATION_ID}`,
      { failOnStatusCode: false },
    )
    expect(res.status()).toBe(404)
  })

  test('Ask AI streams the stubbed reply and reports a session id', async ({
    request,
  }) => {
    const res = await request.post(
      `/api/agents/${agentId}/conversations/ask`,
      {
        data: { question: `How many visitors chatted? ${STAMP}` },
        failOnStatusCode: false,
      },
    )
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/plain')
    // The client continues a thread with this header (agent-ask-chat.tsx:67).
    expect(
      res.headers()['x-session-id'],
      'ask must return the conversation id in x-session-id',
    ).toBeTruthy()
    expect(await res.text()).toContain(STUB_REPLY)
  })

  test('Ask AI threads a follow-up onto the same conversation and persists both turns', async ({
    request,
  }) => {
    const first = `First ask ${STAMP}`
    const second = `Second ask ${STAMP}`

    const firstRes = await request.post(
      `/api/agents/${agentId}/conversations/ask`,
      { data: { question: first }, failOnStatusCode: false },
    )
    expect(firstRes.status()).toBe(200)
    const sessionId = firstRes.headers()['x-session-id']
    expect(sessionId).toBeTruthy()
    expect(await firstRes.text()).toContain(STUB_REPLY)

    // Turn 1 must be on disk before turn 2 is sent, otherwise the route replays
    // an empty history and the follow-up assertion below races the writer.
    await expect
      .poll(() => conversationMessageCount(request, sessionId), {
        timeout: 20_000,
        message: 'the first Ask AI turn should be persisted',
      })
      .toBe(2)

    const secondRes = await request.post(
      `/api/agents/${agentId}/conversations/ask`,
      { data: { question: second, sessionId }, failOnStatusCode: false },
    )
    expect(secondRes.status()).toBe(200)
    // A regression that starts a fresh conversation per turn shows up here.
    expect(secondRes.headers()['x-session-id']).toBe(sessionId)
    expect(await secondRes.text()).toContain(STUB_REPLY)

    await expect
      .poll(() => conversationMessageCount(request, sessionId), {
        timeout: 20_000,
        message: 'both Ask AI turns should be persisted on the conversation',
      })
      .toBe(4)

    const read = await request.get(
      `/api/agents/${agentId}/conversations/${sessionId}`,
      { failOnStatusCode: false },
    )
    expect(read.status()).toBe(200)
    const { conversation } = (await read.json()) as {
      conversation: PersistedConversation
    }
    // An owner Ask AI conversation, not a visitor one.
    expect(conversation.externalId).toBeNull()
    expect(
      conversation.messages.map(m => ({ role: m.role, content: m.content })),
    ).toEqual([
      { role: 'user', content: first },
      { role: 'assistant', content: STUB_REPLY },
      { role: 'user', content: second },
      { role: 'assistant', content: STUB_REPLY },
    ])
  })

  test('closing a conversation persists a summary and closedAt', async ({
    request,
  }) => {
    const res = await request.post(
      `/api/agents/${agentId}/conversations/${closableConversationId}/close`,
      { failOnStatusCode: false },
    )
    expect(res.status()).toBe(200)

    const body = (await res.json()) as {
      ok: boolean
      summary: string | null
      closedAt: string
    }
    expect(body.ok).toBe(true)
    // The close route summarizes on demand when the row has no summary yet
    // (close/route.ts:44-48) — a null here means summarization silently failed.
    expect(typeof body.summary).toBe('string')
    // The summary came from the (stubbed) model, not from an echo of the row.
    expect(body.summary).toContain(STUB_REPLY)
    expect(Number.isNaN(Date.parse(body.closedAt))).toBe(false)

    const read = await request.get(
      `/api/agents/${agentId}/conversations/${closableConversationId}`,
      { failOnStatusCode: false },
    )
    expect(read.status()).toBe(200)
    const { conversation } = (await read.json()) as {
      conversation: PersistedConversation
    }
    expect(conversation.summary).toBe(body.summary)
    expect(conversation.closedAt).not.toBeNull()
    expect(Number.isNaN(Date.parse(conversation.closedAt!))).toBe(false)
  })

  test('a non-member cannot close a conversation', async ({ request }) => {
    // The read side is covered by 12-tenant-isolation.spec.ts; the close route
    // is a mutation no spec exercised.
    const outsider = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      storageState: OUTSIDER_STATE,
    })
    try {
      const res = await outsider.post(
        `/api/agents/${agentId}/conversations/${closableConversationId}/close`,
        { failOnStatusCode: false },
      )
      expect(res.status()).toBe(403)
      // A route that "fails open" with 200-and-payload cannot pass.
      expect(await res.text()).not.toContain(CLOSABLE_MESSAGE)
    } finally {
      await outsider.dispose()
    }

    // Prove the refusal was real by reading the row back as the owner.
    const read = await request.get(
      `/api/agents/${agentId}/conversations/${closableConversationId}`,
      { failOnStatusCode: false },
    )
    expect(read.status()).toBe(200)
    const { conversation } = (await read.json()) as {
      conversation: PersistedConversation
    }
    expect(conversation.messages.map(m => m.content)).toContain(
      CLOSABLE_MESSAGE,
    )
  })
})

test.describe('Conversations — UI', () => {
  test('the agent page lists the seeded visitor conversation', async ({
    page,
  }) => {
    await page.goto(`/agents/${agentId}`)
    await expect(page).not.toHaveURL(/sign-in/)
    // Wait for hydration before touching the layout controls.
    await expect(page.getByTestId('chat-input')).toBeVisible({
      timeout: 15_000,
    })

    // Documented precondition: the agent's own sidebar ("Visitor Chat History")
    // is only handed to DashboardLayout while the primary app sidebar is
    // collapsed (agent-chat-with-layout.tsx:498), and `sidebar-is-open`
    // defaults to true in a fresh browser context.
    const collapsePrimarySidebar = page.getByRole('button', {
      name: 'Close Sidebar',
    })
    await expect(collapsePrimarySidebar).toBeVisible({ timeout: 10_000 })
    await collapsePrimarySidebar.click()

    // Scope to the agent sidebar: the primary sidebar also lists visitor
    // conversations, and asserting page-wide would let it satisfy this test.
    // Matched by text rather than by heading role — the section title is an
    // <h3> nested inside a collapse <button> (dashboard-sidebar.tsx:55-63).
    const agentSidebar = page
      .locator('aside')
      .filter({ hasText: 'Visitor Chat History' })
    await expect(agentSidebar.getByText('Visitor Chat History')).toBeVisible({
      timeout: 15_000,
    })

    // The preview label of a conversation with no summary is its first user
    // message (packages/agents/src/conversation-preview.ts).
    await expect(agentSidebar.getByText(VISITOR_MESSAGE)).toBeVisible()
  })

  test('the Ask AI surface renders its input on the agent page', async ({
    page,
  }) => {
    await page.goto(`/agents/${agentId}`)
    await expect(page).not.toHaveURL(/sign-in/)

    const input = page.getByTestId('chat-input')
    await expect(input).toBeVisible({ timeout: 15_000 })
    // Placeholder + heading identify AgentAskChat specifically: the dashboard
    // and focus views can occupy the same slot (agent-chat-with-layout.tsx:517-546),
    // so a view-mode regression fails here with a readable message.
    await expect(input).toHaveAttribute('placeholder', /visitor conversations/i)
    await expect(page.getByText('ASK AI', { exact: true })).toBeVisible()
  })

  test('Ask AI sends a question and renders the stubbed reply', async ({
    page,
  }) => {
    await page.goto(`/agents/${agentId}`)

    const input = page.getByTestId('chat-input')
    await expect(input).toBeVisible({ timeout: 15_000 })
    await expect(input).toHaveAttribute('placeholder', /visitor conversations/i)

    // The most recent owner session is replayed into the thread on load, so
    // count the stub replies already on screen and require exactly one more.
    const repliesBefore = await page.getByText(STUB_REPLY).count()

    const question = `What did the visitor ask? ${Date.now()}`
    await fillChatInput(page, question)

    const sendBtn = page.getByRole('button', { name: 'Send message' })
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 })

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/conversations/ask') && r.status() === 200,
      { timeout: 30_000 },
    )
    await sendBtn.click()
    await responsePromise

    await expect(page.getByText(question)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(STUB_REPLY)).toHaveCount(repliesBefore + 1, {
      timeout: 20_000,
    })
  })
})
