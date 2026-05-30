// THE KEY TEST: proves the OpenAI model is stubbed end-to-end.
//
// The Next dev server runs with OPENAI_BASE_URL pointed at the deterministic
// mock (see playwright.config.ts), so any server-side model call resolves to
// the canned reply text. We drive a real agent chat and assert that canned
// text surfaces.
//
// chatTestApproach: 'api-fallback' (authoritative) + a best-effort UI check.
//
// Why API-fallback is authoritative here (verified against source):
//   - /agents/[id] for the agent OWNER renders <AgentAskChat>, whose input
//     posts to /api/agents/[id]/conversations/ask (an "Ask AI / analyze
//     conversations" flow), NOT the standard chat. The plain <AgentChat>
//     (textarea[placeholder="Type your message..."], POST /api/agents/[id]/chat)
//     only renders for read-only visitors / the widget. Both routes ultimately
//     call the OpenAI model that is redirected to the mock.
//   - So the cleanest deterministic proof is to POST the real auth-guarded chat
//     route directly with the authenticated `request` fixture (it carries the
//     storageState cookies).
//
// Chat API (verified): POST /api/agents/[id]/chat
//   body:    { messages: [{ role, content }] }
//   returns: a text/plain STREAM (Content-Type "text/plain; charset=utf-8",
//            streamProtocol 'text') whose body is the model text — so we assert
//            on the response *text*, not a JSON field.
//
// We obtain an agent for the E2E tenant by listing via the authenticated API,
// creating one through POST /api/agents if none exists. If no agent can be
// obtained the test skips with a reason (never silently passes).
import { test, expect, type APIRequestContext } from '@playwright/test'
import { STORAGE_STATE } from './constants.ts'

// The mock's canned reply (mock-openai.mjs); we assert on a stable substring.
const STUB_SUBSTRING = 'deterministic E2E stubbed reply'

test.use({ storageState: STORAGE_STATE })

// Discover the authed tenant id (the agents list API is tenant-scoped).
async function getActiveTenantId(
  request: APIRequestContext,
): Promise<string | null> {
  const res = await request.get('/api/user/active-tenant')
  if (!res.ok()) return null
  const body = await res.json().catch(() => null)
  return body?.tenant_id ?? body?.tenantId ?? null
}

// Try to find an existing agent id for the authed tenant, creating one if the
// API allows. Returns null if we cannot obtain an agent id.
async function obtainAgentId(request: APIRequestContext): Promise<string | null> {
  const tenantId = await getActiveTenantId(request)

  // 1) List existing agents (tenant-scoped when we know the tenant).
  const listUrl = tenantId
    ? `/api/agents?tenant_id=${encodeURIComponent(tenantId)}`
    : '/api/agents'
  const listRes = await request.get(listUrl)
  if (listRes.ok()) {
    const body = await listRes.json().catch(() => null)
    const arr = Array.isArray(body) ? body : body?.agents ?? body?.data
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.id) {
      return String(arr[0].id)
    }
  }

  // 2) Create one. POST /api/agents validates against upsertAgentSchema; `name`
  // is the only reliably-required field, instructions optional.
  const createRes = await request.post('/api/agents', {
    data: {
      name: 'E2E Stub Agent',
      instructions: 'You are a deterministic test agent.',
    },
    failOnStatusCode: false,
  })
  if (createRes.ok()) {
    const body = await createRes.json().catch(() => null)
    const id = body?.agent?.id ?? body?.id ?? body?.data?.id
    if (id) return String(id)
  }

  // 3) Re-list in case creation succeeded with an unexpected response shape.
  const reListRes = await request.get(listUrl)
  if (reListRes.ok()) {
    const body = await reListRes.json().catch(() => null)
    const arr = Array.isArray(body) ? body : body?.agents ?? body?.data
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.id) {
      return String(arr[0].id)
    }
  }

  return null
}

test('stubbed model reply surfaces via the agent chat API (api-fallback)', async ({
  request,
}) => {
  const agentId = await obtainAgentId(request)
  test.skip(
    !agentId,
    'No agent available for the E2E tenant and none could be created via /api/agents; cannot exercise the chat route.',
  )

  // The authenticated `request` fixture carries the storageState cookies, so
  // this hits the real, auth-guarded chat route — which calls the model that is
  // redirected to the mock. The response is a text/plain stream; read it as text.
  const res = await request.post(`/api/agents/${agentId}/chat`, {
    data: { messages: [{ role: 'user', content: 'Hello from E2E' }] },
  })
  expect(
    res.ok(),
    `POST /api/agents/${agentId}/chat -> ${res.status()}: ${await res
      .text()
      .catch(() => '')}`,
  ).toBeTruthy()
  const text = await res.text()
  expect(text).toContain(STUB_SUBSTRING)
})

test('stubbed model reply surfaces in the chat UI (best-effort)', async ({
  page,
  request,
}) => {
  // The Ask-AI route lazily compiles a RAG path (embeddings + summarize) on
  // first hit under `next dev`, so allow generous headroom for cold start.
  test.setTimeout(120_000)

  const agentId = await obtainAgentId(request)
  test.skip(
    !agentId,
    'No agent available for the E2E tenant and none could be created via /api/agents; cannot exercise the chat UI.',
  )

  await page.goto(`/agents/${agentId}`)
  // Let the agent page (and its lazily-compiled chunks) settle before typing.
  await page.waitForLoadState('networkidle')

  // For the owner, /agents/[id] renders the "Ask AI" surface (AgentAskChat),
  // which uses PromptForm — a single <textarea> with placeholder
  // "Ask about your visitor conversations…". The standard agent chat
  // ("Type your message...") only renders for read-only visitors / the widget,
  // so we target the textarea generically to be robust to which surface loads.
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible({ timeout: 30_000 })

  await input.fill('Summarize the visitor conversations')
  await input.press('Enter')

  // Both the Ask-AI route and the standard chat route stream the model text,
  // which the mock fills with the deterministic stub. Wait for it to render.
  await expect(page.getByText(STUB_SUBSTRING, { exact: false })).toBeVisible({
    timeout: 60_000,
  })
})
