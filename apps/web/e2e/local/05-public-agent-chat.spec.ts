/**
 * Section 5 — Public Agent Chat (Widget)
 *
 * The core user-facing feature: anonymous visitors chat with agents via
 *   /widget/[agentId]                     — embeddable iframe surface
 *   /api/public/agents/[id]/chat          — streaming endpoint (uses runtime.ts)
 *   /api/public/agents/[id]/verify-access — access-gate unlock (password / code)
 *
 * Hardening rules applied here:
 *   - every status assertion is the ONE status the handler returns
 *     (chat/route.ts, verify-access/route.ts, feedback/route.ts)
 *   - no test.skip() escape hatches: fixtures are created and asserted in
 *     beforeAll, so a broken fixture fails loudly instead of skipping green
 *   - mutations are read back (feedback → GET conversation)
 *   - the model is stubbed by e2e/mock-openai.mjs, so the reply text is
 *     deterministic and asserted verbatim rather than as "length > 0"
 */
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page
} from '@playwright/test'
import { STORAGE_STATE, BASE_URL } from '../constants.ts'

// Exactly what mock-openai.mjs replies with (e2e/mock-openai.mjs:15-17).
const STUB_REPLY =
  'This is a deterministic E2E stubbed reply from the mock model.'

// Unique per run: re-runs never collide and no test depends on leftover state.
const RUN = Date.now()
const PUBLIC_AGENT_NAME = `E2E Public Chat Agent ${RUN}`
const GATED_AGENT_NAME = `E2E Gated Agent ${RUN}`
const LOCKED_AGENT_NAME = `E2E Password Gated Agent ${RUN}`
const GATE_PASSWORD = `e2e-gate-pass-${RUN}`

// Shared fixtures — created once in beforeAll, asserted non-empty there.
let publicAgentId = ''
let gatedAgentId = ''
/** Gated agent that also has an access password set, for the unlock path. */
let lockedAgentId = ''

test.describe.configure({ mode: 'serial' })

/** Fill the react-textarea-autosize controlled composer via the native setter. */
async function fillChatInput(page: Page, text: string) {
  await page.getByTestId('chat-input').click()
  await page.evaluate(value => {
    const el = document.querySelector(
      '[data-testid="chat-input"]'
    ) as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
}

/** A brand-new anonymous visitor: its own va_ext / va_access_* cookie jar. */
function newVisitor(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: undefined
  })
}

/** All Set-Cookie header values on a response (headersArray keeps duplicates). */
function setCookies(res: APIResponse): string[] {
  return res
    .headersArray()
    .filter(h => h.name.toLowerCase() === 'set-cookie')
    .map(h => h.value)
}

test.beforeAll(async () => {
  // `next dev` compiles these route handlers on first hit.
  test.setTimeout(120_000)

  // Authenticated context — agent creation and the access-password route
  // require the owner session; the public routes below are hit anonymously.
  const ctx = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE
  })

  try {
    const tenantRes = await ctx.get('/api/user/active-tenant')
    expect(tenantRes.status()).toBe(200)
    const { tenant_id: tenantId } = await tenantRes.json()
    expect(tenantId, 'active tenant is required to create agents').toBeTruthy()

    // POST /api/agents responds 200 { agent } (app/api/agents/route.ts:230).
    // Asserting that exact shape means a fixture failure can never be laundered
    // into a passing "404 from /public/agents/undefined/chat" test.
    const createAgent = async (name: string, allowAnonymous: boolean) => {
      const res = await ctx.post('/api/agents', {
        data: {
          name,
          instructions: 'You are a helpful E2E test agent.',
          tenantId,
          allowAnonymous,
          // Keep the widget deterministic: no suggestion fetches, no caps.
          quickSuggestionsMode: 'off'
        },
        failOnStatusCode: false
      })
      expect(res.status(), `create "${name}": ${await res.text()}`).toBe(200)
      const { agent } = await res.json()
      expect(agent?.id, `create "${name}" returned no agent.id`).toBeTruthy()
      expect(agent.allowAnonymous).toBe(allowAnonymous)
      return agent.id as string
    }

    publicAgentId = await createAgent(PUBLIC_AGENT_NAME, true)
    gatedAgentId = await createAgent(GATED_AGENT_NAME, false)
    lockedAgentId = await createAgent(LOCKED_AGENT_NAME, false)

    // PUT (not POST) sets the access password — 200 { ok: true }.
    const pwRes = await ctx.put(
      `/api/agents/${lockedAgentId}/access-password`,
      {
        data: { password: GATE_PASSWORD },
        failOnStatusCode: false
      }
    )
    expect(pwRes.status(), `set access password: ${await pwRes.text()}`).toBe(
      200
    )
    expect(await pwRes.json()).toEqual({ ok: true })
  } finally {
    await ctx.dispose()
  }
})

test.afterAll(async () => {
  const ctx = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE
  })
  try {
    for (const id of [publicAgentId, gatedAgentId, lockedAgentId]) {
      if (!id) continue
      // Best-effort cleanup — a cleanup hiccup must not mask a test result.
      await ctx.delete(`/api/agents/${id}`, { failOnStatusCode: false })
    }
  } finally {
    await ctx.dispose()
  }
})

test.describe('Public Agent Chat — API', () => {
  test('public chat streams the stubbed reply with the widget headers', async ({
    request
  }) => {
    // No storageState on this fixture — a genuinely anonymous visitor.
    // Generous request timeout: `next dev` compiles this route on first hit.
    const res = await request.post(`/api/public/agents/${publicAgentId}/chat`, {
      data: { messages: [{ role: 'user', content: 'Hello from public E2E' }] },
      failOnStatusCode: false,
      timeout: 60_000
    })

    expect(res.status()).toBe(200)

    // Headers the widget depends on (chat/route.ts:384-401).
    const headers = res.headers()
    expect(headers['content-type']).toContain('text/plain')
    expect(headers['x-agent-id']).toBe(publicAgentId)
    expect(headers['x-agent-name']).toBe(PUBLIC_AGENT_NAME)
    expect(headers['x-conversation-id']).toBeTruthy()

    // The body is the model text after wrapStreamWithCompletionDetection.
    const text = await res.text()
    expect(text).toContain(STUB_REPLY)
    // No internal marker may leak to the visitor (CHAT_COMPLETE / SUGGESTIONS /
    // AGENT_HANDOFF are all HTML comments, and the agent has no response cap).
    expect(text).not.toContain('<!--')
    expect(text).not.toContain('[INFO_COMPLETE]')
  })

  test('gated agent rejects anonymous chat with 403', async ({ request }) => {
    const res = await request.post(`/api/public/agents/${gatedAgentId}/chat`, {
      data: { messages: [{ role: 'user', content: 'Hello' }] },
      failOnStatusCode: false
    })

    // Deterministic 403 from chat/route.ts:83-90. Not ">= 400": a 404 would
    // mean the agent fixture is broken and 500 would mean the handler crashed.
    expect(res.status()).toBe(403)
    expect(await res.text()).toContain('does not allow anonymous chat')
  })

  test('unknown agent id returns 404 rather than a crash', async ({
    request
  }) => {
    // A syntactically valid but non-existent uuid — proves the 403 above is the
    // access gate talking and not "agent not found" in disguise.
    const res = await request.post(
      '/api/public/agents/00000000-0000-4000-8000-000000000000/chat',
      {
        data: { messages: [{ role: 'user', content: 'Hello' }] },
        failOnStatusCode: false
      }
    )
    expect(res.status()).toBe(404)
    expect(await res.text()).toContain('Agent not found')
  })
})

test.describe('Public Agent Chat — Access gate', () => {
  test('verify-access rejects a wrong password with 403 invalid', async () => {
    const visitor = await newVisitor()
    try {
      const res = await visitor.post(
        `/api/public/agents/${lockedAgentId}/verify-access`,
        { data: { value: 'not-the-password' }, failOnStatusCode: false }
      )

      // verify-access/route.ts:72-75 — password miss falls through to the
      // invite-code redemption, which reports reason 'invalid' for an unknown code.
      expect(res.status()).toBe(403)
      expect(await res.json()).toEqual({
        error: 'Invalid password or code',
        code: 'invalid'
      })
      // A failed attempt must not hand out an access cookie.
      expect(
        setCookies(res).some(c => c.startsWith(`va_access_${lockedAgentId}=`))
      ).toBe(false)
    } finally {
      await visitor.dispose()
    }
  })

  test('verify-access rejects a blank value with 400', async () => {
    const visitor = await newVisitor()
    try {
      const res = await visitor.post(
        `/api/public/agents/${lockedAgentId}/verify-access`,
        { data: { value: '' }, failOnStatusCode: false }
      )
      // verifyAccessSchema requires min(1) — verify-access/route.ts:37-40.
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid request' })
    } finally {
      await visitor.dispose()
    }
  })

  test('verify-access on an anonymous agent is a 400 (nothing to unlock)', async () => {
    const visitor = await newVisitor()
    try {
      const res = await visitor.post(
        `/api/public/agents/${publicAgentId}/verify-access`,
        { data: { value: GATE_PASSWORD }, failOnStatusCode: false }
      )
      // verify-access/route.ts:29-34.
      expect(res.status()).toBe(400)
      expect(await res.json()).toEqual({
        error: 'Agent allows anonymous access'
      })
    } finally {
      await visitor.dispose()
    }
  })

  test('the correct password sets the access cookie and unlocks the gated chat', async () => {
    const visitor = await newVisitor()
    try {
      // Before unlocking, the same jar is refused.
      const before = await visitor.post(
        `/api/public/agents/${lockedAgentId}/chat`,
        {
          data: { messages: [{ role: 'user', content: 'let me in' }] },
          failOnStatusCode: false
        }
      )
      expect(before.status()).toBe(403)

      const unlock = await visitor.post(
        `/api/public/agents/${lockedAgentId}/verify-access`,
        { data: { value: GATE_PASSWORD }, failOnStatusCode: false }
      )
      expect(unlock.status()).toBe(200)
      expect(await unlock.json()).toEqual({ ok: true })

      // access-gate.ts:31-45 — HMAC-signed, httpOnly cookie with the same
      // finite lifetime as the server-side access token.
      const accessCookie = setCookies(unlock).find(c =>
        c.startsWith(`va_access_${lockedAgentId}=`)
      )
      expect(
        accessCookie,
        'verify-access must set va_access_<agentId>'
      ).toBeTruthy()
      expect(accessCookie!).toMatch(/httponly/i)
      // The default token/cookie lifetime is 12 hours (see .env.example).
      expect(accessCookie!).toMatch(/max-age=43200/i)

      // Same cookie jar → the gate now opens and the model answers.
      const after = await visitor.post(
        `/api/public/agents/${lockedAgentId}/chat`,
        {
          data: { messages: [{ role: 'user', content: 'hello gated agent' }] },
          failOnStatusCode: false,
          timeout: 60_000
        }
      )
      expect(after.status()).toBe(200)
      expect(after.headers()['x-agent-id']).toBe(lockedAgentId)
      expect(await after.text()).toContain(STUB_REPLY)
    } finally {
      await visitor.dispose()
    }
  })

  test('a single-use invite code unlocks the gate exactly once', async () => {
    // The other half of the unlock chain (verify-access/route.ts:52-63):
    // password miss → redeemInviteCode. Nothing under e2e/ covered it.
    const owner = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE
    })
    const visitor = await newVisitor()
    const secondVisitor = await newVisitor()
    // Fresh per attempt so a retry never collides with its own leftover code.
    const codeValue = `E2ECODE${Date.now()}`

    try {
      const created = await owner.post(
        `/api/agents/${gatedAgentId}/invite-codes`,
        { data: { code: codeValue, maxUses: 1 }, failOnStatusCode: false }
      )
      // invite-codes/route.ts:66 — 201 with the stored (upper-cased) document.
      expect(created.status(), await created.text()).toBe(201)
      const createdDoc = await created.json()
      expect(createdDoc.code).toBe(codeValue.toUpperCase())
      expect(createdDoc.usedCount).toBe(0)

      // Visitor redeems it and can then chat with the gated agent.
      const unlock = await visitor.post(
        `/api/public/agents/${gatedAgentId}/verify-access`,
        { data: { value: codeValue }, failOnStatusCode: false }
      )
      expect(unlock.status()).toBe(200)
      expect(await unlock.json()).toEqual({ ok: true })
      expect(
        setCookies(unlock).some(c => c.startsWith(`va_access_${gatedAgentId}=`))
      ).toBe(true)

      const chatRes = await visitor.post(
        `/api/public/agents/${gatedAgentId}/chat`,
        {
          data: { messages: [{ role: 'user', content: 'code accepted?' }] },
          failOnStatusCode: false,
          timeout: 60_000
        }
      )
      expect(chatRes.status()).toBe(200)
      expect(await chatRes.text()).toContain(STUB_REPLY)

      // maxUses: 1 is enforced — a different visitor is refused.
      const denied = await secondVisitor.post(
        `/api/public/agents/${gatedAgentId}/verify-access`,
        { data: { value: codeValue }, failOnStatusCode: false }
      )
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toEqual({
        error: 'This code has reached its usage limit',
        code: 'max_uses_reached'
      })

      // The redemption was persisted, not just accepted in-memory.
      const listRes = await owner.get(
        `/api/agents/${gatedAgentId}/invite-codes`,
        { failOnStatusCode: false }
      )
      expect(listRes.status()).toBe(200)
      const codes = (await listRes.json()) as Array<{
        code: string
        usedCount: number
      }>
      const stored = codes.find(c => c.code === codeValue.toUpperCase())
      expect(stored, 'created invite code must be listed').toBeTruthy()
      expect(stored!.usedCount).toBe(1)
    } finally {
      await Promise.all([
        owner.dispose(),
        visitor.dispose(),
        secondVisitor.dispose()
      ])
    }
  })

  test('an embedded unlock issues a cross-site (SameSite=None) access cookie', async () => {
    // The widget always posts x-embed: true (access-gate-form.tsx:39-46); inside
    // a third-party iframe a Lax cookie would never be sent back, so the gate
    // would re-appear on every message. Guard the attribute explicitly.
    const visitor = await newVisitor()
    try {
      const res = await visitor.post(
        `/api/public/agents/${lockedAgentId}/verify-access`,
        {
          headers: { 'x-embed': 'true' },
          data: { value: GATE_PASSWORD },
          failOnStatusCode: false
        }
      )
      expect(res.status()).toBe(200)

      const accessCookie = setCookies(res).find(c =>
        c.startsWith(`va_access_${lockedAgentId}=`)
      )
      expect(accessCookie).toBeTruthy()
      expect(accessCookie!).toMatch(/samesite=none/i)
      expect(accessCookie!).toMatch(/secure/i)
    } finally {
      await visitor.dispose()
    }
  })
})

test.describe('Public Agent Widget — UI', () => {
  test('widget renders the agent header and an empty composer', async ({
    page
  }) => {
    await page.goto(`/widget/${publicAgentId}`)
    await expect(page).not.toHaveURL(/sign-in/)

    // Rendered only by public-agent-experience.tsx:224-226 for this agent —
    // a Next notFound() page or the sign-in page would not contain it.
    await expect(
      page.getByText(PUBLIC_AGENT_NAME, { exact: true })
    ).toBeVisible({ timeout: 15_000 })

    await expect(page.getByTestId('chat-input')).toBeVisible({
      timeout: 15_000
    })
    // prompt-form.tsx:268 — send stays disabled until something is typed.
    await expect(
      page.getByRole('button', { name: 'Send message' })
    ).toBeDisabled()
  })

  test('widget chat sends a message and renders the stubbed reply', async ({
    page
  }) => {
    await page.goto(`/widget/${publicAgentId}`)
    await expect(page.getByTestId('chat-input')).toBeVisible({
      timeout: 15_000
    })

    const question = `What can you help me with? ${RUN}`
    await fillChatInput(page, question)

    const sendBtn = page.getByRole('button', { name: 'Send message' })
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 })

    const responsePromise = page.waitForResponse(
      r =>
        r.url().includes(`/api/public/agents/${publicAgentId}/chat`) &&
        r.request().method() === 'POST',
      { timeout: 30_000 }
    )
    await sendBtn.click()
    const chatRes = await responsePromise
    expect(chatRes.status()).toBe(200)
    expect(chatRes.headers()['x-conversation-id']).toBeTruthy()

    // The visitor's own message, then the deterministic model reply — not
    // "some text with 10 letters somewhere on the page".
    await expect(page.getByText(question)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(STUB_REPLY).first()).toBeVisible({
      timeout: 20_000
    })
    await expect(page.getByTestId('chat-input')).toHaveValue('')
  })

  test('gated widget shows the access gate instead of the chat', async ({
    page
  }) => {
    await page.goto(`/widget/${gatedAgentId}`)
    await expect(page).not.toHaveURL(/sign-in/)

    // access-gate-form.tsx:81-100.
    await expect(
      page.getByText('Enter a password or invite code to continue.')
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByPlaceholder('Password or invite code')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()

    // The chat surface must NOT be rendered alongside the gate.
    await expect(page.getByTestId('chat-input')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Send message' })
    ).toHaveCount(0)
  })

  test('entering the access password in the widget reveals the chat', async ({
    page
  }) => {
    await page.goto(`/widget/${lockedAgentId}`)
    const input = page.getByPlaceholder('Password or invite code')
    await expect(input).toBeVisible({ timeout: 15_000 })
    const submit = page.getByRole('button', { name: 'Continue' })

    // Wrong value → the route's error message is surfaced, gate stays up.
    await input.fill('not-the-password')
    await submit.click()
    await expect(page.getByText('Invalid password or code')).toBeVisible({
      timeout: 15_000
    })
    await expect(page.getByTestId('chat-input')).toHaveCount(0)

    // Correct value → gated-widget-page.tsx flips to PublicAgentExperience.
    await input.fill(GATE_PASSWORD)
    await submit.click()
    await expect(page.getByTestId('chat-input')).toBeVisible({
      timeout: 15_000
    })
    await expect(
      page.getByText(LOCKED_AGENT_NAME, { exact: true })
    ).toBeVisible()
    await expect(page.getByPlaceholder('Password or invite code')).toHaveCount(
      0
    )
  })
})

test.describe('Public Agent Chat — Conversation Feedback', () => {
  test('a thumbs-up is stored and reads back on the conversation', async ({
    request
  }) => {
    // Take the conversation id straight off the chat response header the widget
    // itself uses — no conversation-list detour that can silently come back empty.
    const chatRes = await request.post(
      `/api/public/agents/${publicAgentId}/chat`,
      {
        data: {
          messages: [{ role: 'user', content: `Feedback E2E ${RUN}` }]
        },
        failOnStatusCode: false,
        timeout: 60_000
      }
    )
    expect(chatRes.status()).toBe(200)
    const cid = chatRes.headers()['x-conversation-id']
    expect(cid, 'chat must return x-conversation-id').toBeTruthy()

    const comment = `E2E feedback comment ${RUN}`
    const feedbackRes = await request.post(
      `/api/public/agents/${publicAgentId}/conversations/${cid}/feedback`,
      { data: { rating: 'positive', comment }, failOnStatusCode: false }
    )
    // feedback/route.ts:49 returns exactly 200 { ok: true }.
    expect(feedbackRes.status()).toBe(200)
    expect(await feedbackRes.json()).toEqual({ ok: true })

    // Read it back: recordConversationFeedback being a no-op must fail here.
    // Same request fixture → same va_ext cookie → same visitor.
    const readBack = await request.get(
      `/api/public/agents/${publicAgentId}/conversations/${cid}`,
      { failOnStatusCode: false }
    )
    expect(readBack.status()).toBe(200)
    const { conversation } = await readBack.json()
    expect(conversation.id).toBe(cid)
    expect(conversation.feedback?.rating).toBe('positive')
    expect(conversation.feedback?.comment).toBe(comment)
  })

  test('an unknown rating is rejected with 400 and stores nothing', async ({
    request
  }) => {
    const chatRes = await request.post(
      `/api/public/agents/${publicAgentId}/chat`,
      {
        data: {
          messages: [{ role: 'user', content: `Bad rating E2E ${RUN}` }]
        },
        failOnStatusCode: false,
        timeout: 60_000
      }
    )
    expect(chatRes.status()).toBe(200)
    const cid = chatRes.headers()['x-conversation-id']
    expect(cid).toBeTruthy()

    const res = await request.post(
      `/api/public/agents/${publicAgentId}/conversations/${cid}/feedback`,
      { data: { rating: 'meh' }, failOnStatusCode: false }
    )
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Invalid rating. Must be "positive" or "negative".'
    })

    const readBack = await request.get(
      `/api/public/agents/${publicAgentId}/conversations/${cid}`,
      { failOnStatusCode: false }
    )
    expect(readBack.status()).toBe(200)
    const { conversation } = await readBack.json()
    expect(conversation.feedback ?? null).toBeNull()
  })

  test('feedback on an unknown conversation id returns 404', async ({
    request
  }) => {
    const res = await request.post(
      `/api/public/agents/${publicAgentId}/conversations/00000000-0000-4000-8000-000000000000/feedback`,
      { data: { rating: 'positive' }, failOnStatusCode: false }
    )
    // feedback/route.ts:26-32.
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'Conversation not found' })
  })

  test('a second visitor cannot read the first visitor conversation', async ({
    request
  }) => {
    const chatRes = await request.post(
      `/api/public/agents/${publicAgentId}/chat`,
      {
        data: {
          messages: [{ role: 'user', content: `Visitor scoping E2E ${RUN}` }]
        },
        failOnStatusCode: false,
        timeout: 60_000
      }
    )
    expect(chatRes.status()).toBe(200)
    const cid = chatRes.headers()['x-conversation-id']
    expect(cid).toBeTruthy()

    // A second visitor: fresh cookie jar, therefore a different va_ext.
    const other = await newVisitor()
    try {
      const res = await other.get(
        `/api/public/agents/${publicAgentId}/conversations/${cid}`,
        { failOnStatusCode: false }
      )
      // conversations/[cid]/route.ts:28-30 — externalId mismatch is a 401.
      expect(res.status()).toBe(401)

      // …and the public list is scoped to the caller's own va_ext.
      const listRes = await other.get(
        `/api/public/agents/${publicAgentId}/conversations`,
        { failOnStatusCode: false }
      )
      expect(listRes.status()).toBe(200)
      const { conversations } = await listRes.json()
      expect(Array.isArray(conversations)).toBe(true)
      expect(conversations.map((c: { id: string }) => c.id)).not.toContain(cid)
    } finally {
      await other.dispose()
    }
  })
})
