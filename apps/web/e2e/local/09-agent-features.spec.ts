/**
 * Section 9 — Agent Features (modes, tools, versions, embeddings, access gate)
 *
 * Tests the specific features the product is built around:
 *
 * 1. Agent modes — "Info Provider" (answers questions) vs "Info Collector"
 * 2. Tools — builtin:web_fetch / builtin:file_search persist and read back
 * 3. Version history — create, edit, restore (append-only, forward-only)
 * 4. Embeddings end-to-end — upload → register → indexed → public chat
 * 5. Quick suggestions — off / smart / always
 * 6. Access gate — password, invite codes, redemption, gated chat
 *
 * Hardening rules applied here:
 *   - every status assertion is the ONE status the handler returns; no
 *     `>= 400` / `toBeLessThan(500)` bands
 *   - no `test.skip()` escape hatches: every fixture is created and asserted in
 *     a beforeAll (or in the test itself), so a broken fixture fails loudly
 *   - mutations are read back — PATCH → GET, restore → GET, redeem → GET codes
 *   - version assertions are exact (`toBe(n + 1)`), never `toBeGreaterThanOrEqual`
 *     on an append-only list, which cannot fail
 *   - the model is stubbed by e2e/mock-openai.mjs, so the reply is asserted
 *     verbatim (STUB_REPLY) instead of `text.length > 0` — a 200 is committed to
 *     the wire before the model streams a single token, so status alone proves
 *     nothing about the generation
 *   - `tenantId` is never sent in a create body (the route ignores it); the
 *     tenant the session resolves to is asserted on every created agent instead
 *
 * Deliberately NOT covered here (owned elsewhere, do not duplicate):
 *   - cross-tenant IDOR on these routes → 12-tenant-isolation.spec.ts
 *   - the access-gate PASSWORD unlock path → 05-public-agent-chat.spec.ts
 *     (this file covers the invite-code redemption path, which nothing else does)
 */
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from '../constants.ts'

// Exactly what mock-openai.mjs replies with (e2e/mock-openai.mjs:15-17).
const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'

// upsertAgentSchema requires instructions >= 10 chars.
const INSTRUCTIONS = 'You are a deterministic E2E feature-verification agent.'

// Unique per run: re-runs never collide and no test depends on leftover state.
const RUN = Date.now()

test.use({ storageState: STORAGE_STATE })

// ─── Shared helpers ─────────────────────────────────────────────────────────

interface AgentPayload {
  id: string
  tenantId: string
  name: string
  instructions: string
  mode: 'provider' | 'collector'
  tools: Array<{ id: string; type: string; name?: string }>
  fileKeys: string[]
  allowAnonymous: boolean
  quickSuggestionsMode: 'off' | 'smart' | 'always'
  quickSuggestionsCount: number
  retrievalStrategy: string
  currentVersion?: number
}

interface AgentVersionRow {
  versionNo: number
  source: string
  changeNote: string | null
  restoredFrom: number | null
  createdBy: string | null
  createdAt: string
  isCurrent: boolean
}

interface FileRow {
  fileKey: string
  fileName: string
  mimeType: string
  status: string
  embeddingProvider: string | null
}

interface InviteCode {
  id: string
  code: string
  maxUses: number | null
  usedCount: number
  revoked: boolean
  redemptions: Array<{ redeemedAt: string; externalId: string }>
}

/** The tenant the session resolves to — asserted on every agent we create. */
let tenantId = ''
const createdAgentIds: string[] = []

/**
 * Create an agent and assert the create contract: 200 { agent: { id } } and a
 * tenant taken from the session. Note the payload deliberately carries NO
 * `tenantId` — app/api/agents/route.ts:142 parses with a non-strict zod object
 * that drops it and resolves the tenant from getActiveTenant(user.id).
 */
async function createAgent(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<AgentPayload> {
  const res = await request.post('/api/agents', {
    data: { instructions: INSTRUCTIONS, ...data },
    failOnStatusCode: false,
  })
  expect(res.status(), `POST /api/agents: ${await res.text()}`).toBe(200)
  const { agent } = await res.json()
  expect(agent?.id, 'POST /api/agents must return { agent: { id } }').toBeTruthy()
  expect(
    agent.tenantId,
    'a new agent must land in the session active tenant',
  ).toBe(tenantId)
  createdAgentIds.push(agent.id)
  return agent as AgentPayload
}

async function getAgent(
  request: APIRequestContext,
  agentId: string,
): Promise<AgentPayload> {
  const res = await request.get(`/api/agents/${agentId}`, {
    failOnStatusCode: false,
  })
  expect(res.status(), `GET /api/agents/${agentId}: ${await res.text()}`).toBe(200)
  const { agent } = await res.json()
  return agent as AgentPayload
}

async function patchAgent(
  request: APIRequestContext,
  agentId: string,
  data: Record<string, unknown>,
): Promise<AgentPayload> {
  const res = await request.patch(`/api/agents/${agentId}`, {
    data,
    failOnStatusCode: false,
  })
  expect(res.status(), `PATCH /api/agents/${agentId}: ${await res.text()}`).toBe(200)
  const { agent } = await res.json()
  return agent as AgentPayload
}

async function listVersions(
  request: APIRequestContext,
  agentId: string,
): Promise<{ versions: AgentVersionRow[]; currentVersion: number }> {
  const res = await request.get(`/api/agents/${agentId}/versions`, {
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as {
    versions: AgentVersionRow[]
    currentVersion: number
  }
}

async function listAgentFiles(
  request: APIRequestContext,
  agentId: string,
): Promise<FileRow[]> {
  const res = await request.get(`/api/agents/${agentId}/files`, {
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()).files ?? []) as FileRow[]
}

/** POST the public chat endpoint as whatever visitor `ctx` represents. */
function publicChat(
  ctx: APIRequestContext,
  agentId: string,
  content: string,
): Promise<APIResponse> {
  return ctx.post(`/api/public/agents/${agentId}/chat`, {
    data: { messages: [{ role: 'user', content }] },
    failOnStatusCode: false,
  })
}

/** A brand-new anonymous visitor: its own va_ext / va_access_* cookie jar. */
function newVisitor(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL, storageState: undefined })
}

/** All Set-Cookie header values on a response (headersArray keeps duplicates). */
function setCookies(res: APIResponse): string[] {
  return res
    .headersArray()
    .filter(h => h.name.toLowerCase() === 'set-cookie')
    .map(h => h.value)
}

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant', {
    failOnStatusCode: false,
  })
  expect(tenantRes.status(), await tenantRes.text()).toBe(200)
  tenantId = (await tenantRes.json()).tenant_id
  expect(tenantId, 'an active tenant is required to create agents').toBeTruthy()
})

test.afterAll(async ({ request }) => {
  // Best-effort teardown — a cleanup hiccup must never mask a test result.
  for (const id of createdAgentIds.splice(0)) {
    await request.delete(`/api/agents/${id}`, { failOnStatusCode: false })
  }
})

// ─── 0. Tenant scoping of agent creation ────────────────────────────────────

test.describe('Agent creation is scoped by the session, not the request body', () => {
  test('a body-supplied tenantId is ignored — the agent lands in the active tenant', async ({
    request,
  }) => {
    // Every create body in this file used to carry `tenantId`, which reads as
    // if agents were pinned to it. upsertAgentSchema is a non-strict z.object,
    // so the key is silently dropped and getActiveTenant(user.id) decides.
    // Sending a foreign id must therefore NOT move the agent (and must not 500).
    const agent = await createAgent(request, {
      name: `E2E Tenant Scoping ${RUN}`,
      tenantId: '00000000-0000-4000-8000-000000000000',
    })
    expect(agent.tenantId).toBe(tenantId)

    // Read it back through a second route so the assertion is not just an echo
    // of the create response.
    expect((await getAgent(request, agent.id)).tenantId).toBe(tenantId)
  })
})

// ─── 1. Agent Modes ─────────────────────────────────────────────────────────

test.describe('Agent Modes', () => {
  test('an agent created in collector mode reads back as collector', async ({
    request,
  }) => {
    const created = await createAgent(request, {
      name: `E2E Collector ${RUN}`,
      allowAnonymous: true,
      mode: 'collector',
    })
    expect(created.mode).toBe('collector')

    const fetched = await getAgent(request, created.id)
    expect(fetched.mode).toBe('collector')
  })

  test('mode updates from provider to collector without clobbering the rest', async ({
    request,
  }) => {
    const name = `E2E Mode Switch ${RUN}`
    const created = await createAgent(request, { name })
    // agentModeSchema defaults to 'provider' — assert the baseline so the
    // update below cannot pass on an agent that was already a collector.
    expect(created.mode).toBe('provider')

    const patched = await patchAgent(request, created.id, { mode: 'collector' })
    expect(patched.mode).toBe('collector')

    const fetched = await getAgent(request, created.id)
    expect(fetched.mode).toBe('collector')
    // A PATCH that rebuilt the row from defaults would wipe these.
    expect(fetched.name).toBe(name)
    expect(fetched.instructions).toBe(INSTRUCTIONS)
  })

  test('the setup tab renders the mode this agent actually has', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Mode UI ${RUN}`,
      mode: 'collector',
    })

    // ?tab=configure is the legacy alias resolved to 'setup'
    // (agent-dashboard-tabs.tsx:51-53).
    await page.goto(`/agents/${agent.id}?tab=configure`)
    await expect(page).not.toHaveURL(/sign-in/)

    // Scope every assertion to the active Radix tab panel so the sidebar and
    // the shared dashboard layout cannot satisfy them.
    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText('Agent Mode', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(panel.getByText('Info Provider', { exact: true })).toBeVisible()
    await expect(panel.getByText('Info Collector', { exact: true })).toBeVisible()

    // agent-setup-tab.tsx:240-244 — the blurb is derived from the SAVED mode,
    // so this fails if the page renders a static selector that ignores the
    // agent, or if collector mode stopped persisting.
    await expect(
      panel.getByText('Agent will gather information from users'),
    ).toBeVisible()
    await expect(
      panel.getByText('Agent will provide information to users'),
    ).toHaveCount(0)
  })
})

// ─── 2. Tools (Web Fetch / File Search) ─────────────────────────────────────

test.describe('Agent Tools', () => {
  test('builtin:web_fetch persists on create and reads back', async ({
    request,
  }) => {
    const created = await createAgent(request, {
      name: `E2E Web Fetch ${RUN}`,
      allowAnonymous: true,
      tools: [{ id: 'builtin:web_fetch', type: 'builtin:web_fetch' }],
    })
    // sanitizeTools (packages/agents/src/db.ts:53-98) normalises every entry to
    // { id: type, type, name, description }, so the exact array is assertable.
    expect(created.tools.map(t => t.type)).toEqual(['builtin:web_fetch'])

    const fetched = await getAgent(request, created.id)
    expect(fetched.tools.map(t => t.type)).toEqual(['builtin:web_fetch'])
    expect(fetched.tools[0].id).toBe('builtin:web_fetch')
    expect(fetched.tools[0].name).toBe('Web Fetch')
  })

  test('PATCH replaces the tool set and an empty array clears it', async ({
    request,
  }) => {
    const created = await createAgent(request, {
      name: `E2E Tool Swap ${RUN}`,
      tools: [{ id: 'builtin:web_fetch', type: 'builtin:web_fetch' }],
    })

    const swapped = await patchAgent(request, created.id, {
      tools: [{ id: 'builtin:file_search', type: 'builtin:file_search' }],
    })
    expect(swapped.tools.map(t => t.type)).toEqual(['builtin:file_search'])
    expect((await getAgent(request, created.id)).tools.map(t => t.type)).toEqual([
      'builtin:file_search',
    ])

    // `tools: []` is a real value, not "unset" — route.ts:120 writes it.
    await patchAgent(request, created.id, { tools: [] })
    expect((await getAgent(request, created.id)).tools).toEqual([])
  })

  test('the knowledge tab renders the tool toggles in this agent saved state', async ({
    page,
    request,
  }) => {
    // Tools (Web Fetch, File search) live in the KNOWLEDGE tab, not Setup.
    const agent = await createAgent(request, {
      name: `E2E Tools UI ${RUN}`,
      tools: [{ id: 'builtin:web_fetch', type: 'builtin:web_fetch' }],
    })

    await page.goto(`/agents/${agent.id}?tab=knowledge`)
    await expect(page).not.toHaveURL(/sign-in/)

    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText('Tools & Files', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(panel.getByText('Web Fetch', { exact: true })).toBeVisible()
    await expect(panel.getByText('File search', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Save Tools' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Upload Files' })).toBeVisible()

    // deriveToolToggles(agent.tools) drives both switches (tools-files-manager
    // .tsx:52-54) and they render in this order: Web Fetch, then File search.
    // Asserting the states — not just their presence — is what makes this fail
    // if the saved tools stop reaching the component.
    const switches = panel.getByRole('switch')
    await expect(switches).toHaveCount(2)
    await expect(switches.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'false')

    // Proof the knowledge panel replaced the setup panel rather than sitting
    // alongside it (Radix unmounts inactive tab content).
    await expect(panel.getByText('Agent Mode', { exact: true })).toHaveCount(0)
  })

  test('public chat on a web-fetch agent streams the stubbed reply', async ({
    request,
  }) => {
    const name = `E2E Web Fetch Chat ${RUN}`
    const agent = await createAgent(request, {
      name,
      allowAnonymous: true,
      quickSuggestionsMode: 'off',
      tools: [{ id: 'builtin:web_fetch', type: 'builtin:web_fetch' }],
    })

    const res = await publicChat(request, agent.id, 'Hello, what can you do?')

    // The route commits 200 + headers before the model produces a token
    // (chat/route.ts:384), so the body assertion below is the part that can
    // actually fail when the toolkit/stream wiring breaks mid-generation.
    expect(res.status()).toBe(200)
    const headers = res.headers()
    expect(headers['content-type']).toContain('text/plain')
    expect(headers['x-agent-id']).toBe(agent.id)
    expect(headers['x-agent-name']).toBe(name)
    expect(headers['x-agent-mode']).toBe('provider')
    expect(headers['x-conversation-id']).toBeTruthy()

    const text = await res.text()
    expect(text).toContain(STUB_REPLY)
    // Internal completion markers are HTML comments and must never reach a visitor.
    expect(text).not.toContain('<!--')
  })
})

// ─── 3. Version History ──────────────────────────────────────────────────────

test.describe('Version History', () => {
  const ORIGINAL_INSTRUCTIONS = 'Original instructions v1 for the E2E agent.'
  const UPDATED_INSTRUCTIONS = 'Updated instructions v2 for the E2E agent.'

  // Every test creates its own agent: nothing here depends on a previous test
  // having produced a second version (the old file skipped itself when it had not).

  test('a new agent has exactly one version — v1, source create, current', async ({
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Versions New ${RUN}`,
      instructions: ORIGINAL_INSTRUCTIONS,
    })

    const { versions, currentVersion } = await listVersions(request, agent.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      versionNo: 1,
      source: 'create',
      restoredFrom: null,
      isCurrent: true,
    })
    expect(currentVersion).toBe(1)
  })

  test('editing appends exactly one version; an identical edit appends none', async ({
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Versions Edit ${RUN}`,
      instructions: ORIGINAL_INSTRUCTIONS,
    })
    const before = await listVersions(request, agent.id)
    expect(before.versions).toHaveLength(1)

    const note = `E2E change note ${RUN}`
    const patched = await patchAgent(request, agent.id, {
      instructions: UPDATED_INSTRUCTIONS,
      changeNote: note,
    })
    expect(patched.instructions).toBe(UPDATED_INSTRUCTIONS)
    expect(patched.currentVersion).toBe(2)

    const after = await listVersions(request, agent.id)
    // Exact, not `>=`: the versions list is append-only, so a `>=` assertion is
    // satisfied by the very regression it exists to catch.
    expect(after.versions).toHaveLength(before.versions.length + 1)
    expect(after.currentVersion).toBe(2)
    expect(after.versions[0]).toMatchObject({
      versionNo: 2,
      source: 'update',
      changeNote: note,
      restoredFrom: null,
      isCurrent: true,
    })
    // v1 must survive untouched — history is never rewritten.
    expect(after.versions[1]).toMatchObject({ versionNo: 1, source: 'create' })

    // recordAgentVersion is a deliberate no-op when the config snapshot is
    // unchanged (versioning.ts:119, :153-154). Pin that contract down so a
    // future "always insert" regression is visible rather than silent.
    await patchAgent(request, agent.id, { instructions: UPDATED_INSTRUCTIONS })
    const repeat = await listVersions(request, agent.id)
    expect(repeat.versions).toHaveLength(2)
    expect(repeat.currentVersion).toBe(2)
  })

  test('restoring v1 rolls the config back and appends a restore version', async ({
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Versions Restore ${RUN}`,
      instructions: ORIGINAL_INSTRUCTIONS,
    })
    await patchAgent(request, agent.id, { instructions: UPDATED_INSTRUCTIONS })

    // Guarantee the precondition instead of skipping on it.
    const beforeRestore = await listVersions(request, agent.id)
    expect(beforeRestore.versions).toHaveLength(2)

    const res = await request.post(
      `/api/agents/${agent.id}/versions/1/restore`,
      { failOnStatusCode: false },
    )
    expect(res.status(), await res.text()).toBe(200)
    const body = await res.json()
    expect(body.restoredFrom).toBe(1)
    // Forward-only: the restore itself becomes v3 (versioning.ts:252-291).
    expect(body.versionNo).toBe(3)
    expect(body.warnings).toEqual([])
    expect(body.agent.instructions).toBe(ORIGINAL_INSTRUCTIONS)

    const fetched = await getAgent(request, agent.id)
    expect(fetched.instructions).toBe(ORIGINAL_INSTRUCTIONS)
    expect(fetched.currentVersion).toBe(3)

    const after = await listVersions(request, agent.id)
    expect(after.versions).toHaveLength(3)
    expect(after.currentVersion).toBe(3)
    expect(after.versions[0]).toMatchObject({
      versionNo: 3,
      source: 'restore',
      restoredFrom: 1,
      isCurrent: true,
    })
  })

  test('restore rejects a bad version number: 400 for 0, 404 for a missing one', async ({
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Versions Bad Restore ${RUN}`,
      instructions: ORIGINAL_INSTRUCTIONS,
    })

    const zero = await request.post(`/api/agents/${agent.id}/versions/0/restore`, {
      failOnStatusCode: false,
    })
    expect(zero.status()).toBe(400)
    expect(await zero.json()).toEqual({ error: 'Invalid version number' })

    const missing = await request.post(
      `/api/agents/${agent.id}/versions/99/restore`,
      { failOnStatusCode: false },
    )
    expect(missing.status()).toBe(404)
    expect((await missing.json()).error).toContain('not found')

    // A rejected restore must not have touched the agent or its history.
    const after = await listVersions(request, agent.id)
    expect(after.versions).toHaveLength(1)
    expect((await getAgent(request, agent.id)).instructions).toBe(
      ORIGINAL_INSTRUCTIONS,
    )
  })

  test('the history tab lists both versions, the change note and one Restore', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Versions UI ${RUN}`,
      instructions: ORIGINAL_INSTRUCTIONS,
    })
    const note = `E2E history note ${RUN}`
    await patchAgent(request, agent.id, {
      instructions: UPDATED_INSTRUCTIONS,
      changeNote: note,
    })

    await page.goto(`/agents/${agent.id}?tab=history`)
    await expect(page).not.toHaveURL(/sign-in/)

    const panel = page.getByRole('tabpanel')
    await expect(panel.getByText('Version History', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    // SOURCE_LABELS in agent-version-history-tab.tsx:27-34.
    await expect(panel.getByText('Created', { exact: true })).toBeVisible()
    await expect(panel.getByText('Updated', { exact: true })).toBeVisible()
    await expect(panel.getByText('Current', { exact: true })).toBeVisible()
    // The note is only rendered when the version row actually carries one.
    await expect(panel.getByText(note, { exact: true })).toBeVisible()

    // Restore is offered for every NON-current version — exactly one here.
    // If PATCH stopped producing versions there would be a single (current)
    // row and this count would be 0.
    await expect(panel.getByRole('button', { name: /^restore$/i })).toHaveCount(1)
  })
})

// ─── 4. Embeddings / Knowledge Base End-to-End ───────────────────────────────

test.describe('Embeddings & Knowledge Base', () => {
  let ragAgentId = ''
  const ragFileName = `rag-${RUN}.txt`
  let ragFileKey = ''
  const RAG_CONTENT =
    'The sky is blue. The sun is yellow. Water is wet. Canary token: ' +
    `RAGDOC-${RUN}.`

  test.beforeAll(async ({ request }) => {
    const agent = await createAgent(request, {
      name: `E2E RAG ${RUN}`,
      allowAnonymous: true,
      quickSuggestionsMode: 'off',
      tools: [{ id: 'builtin:file_search', type: 'builtin:file_search' }],
      retrievalStrategy: 'rag',
    })
    ragAgentId = agent.id
    expect(agent.retrievalStrategy).toBe('rag')
    ragFileKey = `tenants/${tenantId}/agents/${ragAgentId}/files/${ragFileName}`

    // upload-url → PUT → POST /files. Each step is asserted: a MinIO or presign
    // failure must fail the suite, not silently skip it the way it used to.
    const urlRes = await request.post(
      `/api/agents/${ragAgentId}/files/upload-url`,
      {
        data: { key: ragFileKey, contentType: 'text/plain' },
        failOnStatusCode: false,
      },
    )
    expect(urlRes.status(), await urlRes.text()).toBe(200)
    const { uploadUrl } = await urlRes.json()
    expect(uploadUrl, 'upload-url must return a presigned PUT URL').toBeTruthy()

    const put = await request.put(uploadUrl, {
      data: RAG_CONTENT,
      headers: { 'Content-Type': 'text/plain' },
      failOnStatusCode: false,
    })
    expect(
      put.status(),
      `presigned PUT to object storage failed: ${await put.text()}`,
    ).toBe(200)

    const register = await request.post(`/api/agents/${ragAgentId}/files`, {
      data: {
        files: [
          {
            fileKey: ragFileKey,
            fileName: ragFileName,
            fileSize: RAG_CONTENT.length,
            mimeType: 'text/plain',
          },
        ],
      },
      failOnStatusCode: false,
    })
    expect(register.status(), await register.text()).toBe(200)
    const registered = (await register.json()).files as FileRow[]
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      fileKey: ragFileKey,
      fileName: ragFileName,
      status: 'pending',
    })
  })

  test('upload-url signs a SigV4 PUT for exactly the requested key', async ({
    request,
  }) => {
    const key = `tenants/${tenantId}/agents/${ragAgentId}/files/presign-${RUN}.txt`
    const res = await request.post(
      `/api/agents/${ragAgentId}/files/upload-url`,
      { data: { key, contentType: 'text/plain' }, failOnStatusCode: false },
    )
    expect(res.status(), await res.text()).toBe(200)

    const { uploadUrl } = await res.json()
    expect(uploadUrl).toBeTruthy()
    // The old assertion was `toContain('127.0.0.1')`, which only echoed the
    // Playwright config's own S3_ENDPOINT back at itself.
    const url = new URL(uploadUrl)
    expect(
      url.pathname.endsWith(`/${key}`),
      `signed path ${url.pathname} must end with the requested key`,
    ).toBe(true)
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
    expect(url.searchParams.get('X-Amz-Credential')).toBeTruthy()
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeGreaterThan(0)
  })

  test('the registered file is embedded and reaches status indexed', async ({
    request,
  }) => {
    // The key must also land on the agent — without it the retriever never
    // sees the document.
    const agent = await getAgent(request, ragAgentId)
    expect(agent.fileKeys).toContain(ragFileKey)

    // POST /files fires processFile() as a floating promise whose rejections are
    // only console.error'd (files/route.ts:191-205), so a completely broken
    // embedding pipeline leaves the row at 'pending'/'failed' while the route
    // still answers 200. embeddingProvider is written only by
    // ingestFileForAgent's success path (file-search.ts:400-403) — a file can be
    // flagged 'indexed' by processFile with a null provider when embedding
    // silently bailed, so both fields are asserted.
    await expect
      .poll(
        async () => {
          const rows = await listAgentFiles(request, ragAgentId)
          const row = rows.find(f => f.fileKey === ragFileKey)
          return { status: row?.status, embeddingProvider: row?.embeddingProvider }
        },
        {
          message: 'the registered file must be embedded by the background processor',
          timeout: 45_000,
          intervals: [500, 1_000, 2_000],
        },
      )
      .toEqual({ status: 'indexed', embeddingProvider: 'openai' })
  })

  test('public chat on the RAG agent streams the stubbed reply', async ({
    request,
  }) => {
    const res = await publicChat(request, ragAgentId, 'What color is the sky?')

    expect(res.status()).toBe(200)
    expect(res.headers()['x-agent-id']).toBe(ragAgentId)
    expect(res.headers()['x-conversation-id']).toBeTruthy()
    // NOTE: retrieval *relevance* is not assertable here — mock-openai.mjs
    // returns one constant 1536-dim vector for every input (mock-openai.mjs:33),
    // so every chunk is equidistant, and the canned reply never varies with the
    // prompt. What this does catch is a RagRetriever/stream failure, which
    // truncates the body while the 200 is already on the wire.
    const text = await res.text()
    expect(text).toContain(STUB_REPLY)
    expect(text).not.toContain('<!--')
  })

  test('the knowledge tab lists the uploaded file', async ({ page }) => {
    await page.goto(`/agents/${ragAgentId}?tab=knowledge`)
    await expect(page).not.toHaveURL(/sign-in/)

    const panel = page.getByRole('tabpanel')
    await expect(panel.getByRole('button', { name: 'Upload Files' })).toBeVisible({
      timeout: 20_000,
    })
    // tools-files-manager.tsx:666-680 renders the count and one row per key.
    await expect(panel.getByText('1 file uploaded', { exact: true })).toBeVisible()
    await expect(panel.getByText(ragFileName, { exact: true })).toBeVisible()
    // This agent was created with builtin:file_search and no web tool.
    const switches = panel.getByRole('switch')
    await expect(switches).toHaveCount(2)
    await expect(switches.nth(0)).toHaveAttribute('aria-checked', 'false')
    await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'true')
  })
})

// ─── 5. Quick Suggestions ───────────────────────────────────────────────────

test.describe('Quick Suggestions', () => {
  test('always-on suggestions persist with their count', async ({ request }) => {
    const created = await createAgent(request, {
      name: `E2E Suggestions ${RUN}`,
      quickSuggestionsMode: 'always',
      quickSuggestionsCount: 3,
    })
    expect(created.quickSuggestionsMode).toBe('always')
    expect(created.quickSuggestionsCount).toBe(3)

    const fetched = await getAgent(request, created.id)
    expect(fetched.quickSuggestionsMode).toBe('always')
    expect(fetched.quickSuggestionsCount).toBe(3)
  })

  test('PATCH switches the suggestion mode and reads back', async ({
    request,
  }) => {
    const created = await createAgent(request, {
      name: `E2E Suggestions Patch ${RUN}`,
      quickSuggestionsMode: 'always',
      quickSuggestionsCount: 3,
    })

    const patched = await patchAgent(request, created.id, {
      quickSuggestionsMode: 'off',
    })
    expect(patched.quickSuggestionsMode).toBe('off')

    const fetched = await getAgent(request, created.id)
    expect(fetched.quickSuggestionsMode).toBe('off')
    // Switching the mode must not silently reset the count.
    expect(fetched.quickSuggestionsCount).toBe(3)
  })

  test('the setup tab reflects the saved quick-suggestion mode', async ({
    page,
    request,
  }) => {
    const agent = await createAgent(request, {
      name: `E2E Suggestions UI ${RUN}`,
      quickSuggestionsMode: 'always',
      quickSuggestionsCount: 3,
    })

    await page.goto(`/agents/${agent.id}?tab=configure`)
    await expect(page).not.toHaveURL(/sign-in/)

    const panel = page.getByRole('tabpanel')
    await expect(
      panel.getByText('Quick Suggestions', { exact: true }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText('Off', { exact: true })).toBeVisible()
    await expect(panel.getByText('Smart', { exact: true })).toBeVisible()
    await expect(panel.getByText('Always', { exact: true })).toBeVisible()

    // agent-setup-tab.tsx:371-377 — the blurb and the count input are derived
    // from the SAVED mode, so a page that ignores the agent fails here.
    await expect(
      panel.getByText('Suggestions appear after every agent reply.'),
    ).toBeVisible()
    // max=5 is unique to the suggestions count input (the response-limit inputs
    // are max=500 / max=100000).
    await expect(
      panel.locator('input[type="number"][max="5"]'),
    ).toHaveValue('3')
  })
})

// ─── 6. Access Gate ──────────────────────────────────────────────────────────

test.describe('Access Gate', () => {
  let gatedAgentId = ''
  const GATE_PASSWORD = `e2e-gate-pass-${RUN}`

  /**
   * Invite codes are unique per (tenant, agent, code) and are stored
   * upper-cased, so every code this section creates carries its own random
   * suffix — a re-run can never collide with itself.
   */
  const uniqueCode = (label: string) =>
    `E2E-${label}-${RUN}-${Math.floor(Math.random() * 1e6)}`

  test.beforeAll(async ({ request }) => {
    // A dedicated gated agent — the section no longer mutates a shared agent
    // that the UI tests above also read.
    const agent = await createAgent(request, {
      name: `E2E Gated ${RUN}`,
      allowAnonymous: false,
      quickSuggestionsMode: 'off',
    })
    expect(agent.allowAnonymous).toBe(false)
    gatedAgentId = agent.id
  })

  test('setting an access password returns 200 and the UI shows it is set', async ({
    page,
    request,
  }) => {
    // Route uses PUT (not POST) to set/replace the access password.
    const res = await request.put(
      `/api/agents/${gatedAgentId}/access-password`,
      { data: { password: GATE_PASSWORD }, failOnStatusCode: false },
    )
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Read the mutation back through the product surface. The API response
    // shape cannot be used for this: GET /api/agents/[id] returns the raw
    // access-gate hash as `accessPassword`, which should be removed rather than
    // asserted (see the report's appChangesNeeded).
    await page.goto(`/agents/${gatedAgentId}?tab=configure`)
    const panel = page.getByRole('tabpanel')
    await expect(
      panel.getByText('Access Password', { exact: true }),
    ).toBeVisible({ timeout: 20_000 })
    // invite-code-manager.tsx:158-163 renders this badge only when a password
    // is stored; the "Set a password" input is what shows otherwise.
    await expect(panel.getByText('Password set', { exact: true })).toBeVisible()
    await expect(panel.getByPlaceholder('Set a password')).toHaveCount(0)
  })

  test('an invite code is created with 201 and appears in the listing', async ({
    request,
  }) => {
    const code = uniqueCode('LIST')
    const res = await request.post(`/api/agents/${gatedAgentId}/invite-codes`, {
      data: { code, maxUses: 10 },
      failOnStatusCode: false,
    })
    // invite-codes/route.ts:66 — 201, not "any 2xx".
    expect(res.status(), await res.text()).toBe(201)
    const created = (await res.json()) as InviteCode
    expect(created).toMatchObject({
      code,
      maxUses: 10,
      usedCount: 0,
      revoked: false,
      redemptions: [],
    })
    expect(created.id).toBeTruthy()

    const list = await request.get(`/api/agents/${gatedAgentId}/invite-codes`, {
      failOnStatusCode: false,
    })
    expect(list.status()).toBe(200)
    // The route returns the array itself (NextResponse.json(codes)) — the old
    // `body.codes ?? body` fallback hid which shape was real.
    const codes = (await list.json()) as InviteCode[]
    expect(Array.isArray(codes)).toBe(true)
    expect(codes.map(c => c.code)).toContain(created.code)
  })

  test('anonymous chat on a gated agent is refused with exactly 403', async () => {
    const visitor = await newVisitor()
    try {
      const res = await publicChat(visitor, gatedAgentId, 'Hello')
      // chat/route.ts:83-90. Not ">= 400": a 404 would mean the fixture agent
      // is missing and a 500 would mean the handler crashed — both of which the
      // old assertion accepted as a pass.
      expect(res.status()).toBe(403)
      expect(await res.text()).toContain('does not allow anonymous chat')
    } finally {
      await visitor.dispose()
    }
  })

  test('redeeming an invite code unlocks the gated chat and is recorded', async ({
    request,
  }) => {
    const code = uniqueCode('REDEEM')
    const createRes = await request.post(
      `/api/agents/${gatedAgentId}/invite-codes`,
      { data: { code, maxUses: 5 }, failOnStatusCode: false },
    )
    expect(createRes.status()).toBe(201)
    const created = (await createRes.json()) as InviteCode

    const visitor = await newVisitor()
    try {
      // Before redeeming, this jar is refused.
      expect((await publicChat(visitor, gatedAgentId, 'let me in')).status()).toBe(
        403,
      )

      const unlock = await visitor.post(
        `/api/public/agents/${gatedAgentId}/verify-access`,
        { data: { value: created.code }, failOnStatusCode: false },
      )
      expect(unlock.status(), await unlock.text()).toBe(200)
      expect(await unlock.json()).toEqual({ ok: true })

      // access-gate.ts:31-45 — HMAC-signed, httpOnly, session-scoped cookie.
      const accessCookie = setCookies(unlock).find(c =>
        c.startsWith(`va_access_${gatedAgentId}=`),
      )
      expect(
        accessCookie,
        'verify-access must set va_access_<agentId>',
      ).toBeTruthy()
      expect(accessCookie!).toMatch(/httponly/i)

      // Same jar → the gate opens and the model answers.
      const after = await publicChat(visitor, gatedAgentId, 'hello gated agent')
      expect(after.status()).toBe(200)
      expect(after.headers()['x-agent-id']).toBe(gatedAgentId)
      expect(await after.text()).toContain(STUB_REPLY)
    } finally {
      await visitor.dispose()
    }

    // Redemption must be durable, not just a cookie: usedCount is incremented
    // and the redemption recorded (invite-codes.ts:105-113).
    const list = await request.get(`/api/agents/${gatedAgentId}/invite-codes`, {
      failOnStatusCode: false,
    })
    expect(list.status()).toBe(200)
    const stored = ((await list.json()) as InviteCode[]).find(
      c => c.id === created.id,
    )
    expect(stored, 'the redeemed code must still be listed').toBeTruthy()
    expect(stored!.usedCount).toBe(1)
    expect(stored!.redemptions).toHaveLength(1)
    expect(stored!.redemptions[0].externalId).toBeTruthy()
  })

  test('a code at its use limit is refused with max_uses_reached', async ({
    request,
  }) => {
    const code = uniqueCode('ONESHOT')
    const createRes = await request.post(
      `/api/agents/${gatedAgentId}/invite-codes`,
      { data: { code, maxUses: 1 }, failOnStatusCode: false },
    )
    expect(createRes.status()).toBe(201)

    const first = await newVisitor()
    try {
      const ok = await first.post(
        `/api/public/agents/${gatedAgentId}/verify-access`,
        { data: { value: code }, failOnStatusCode: false },
      )
      expect(ok.status(), await ok.text()).toBe(200)
    } finally {
      await first.dispose()
    }

    const second = await newVisitor()
    try {
      const denied = await second.post(
        `/api/public/agents/${gatedAgentId}/verify-access`,
        { data: { value: code }, failOnStatusCode: false },
      )
      // verify-access/route.ts:66-75 — the exact reason, not a 4xx band.
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toEqual({
        error: 'This code has reached its usage limit',
        code: 'max_uses_reached',
      })
      expect(
        setCookies(denied).some(c => c.startsWith(`va_access_${gatedAgentId}=`)),
        'a refused redemption must not hand out an access cookie',
      ).toBe(false)

      // …and the gate really is still shut for that visitor.
      expect((await publicChat(second, gatedAgentId, 'hi')).status()).toBe(403)
    } finally {
      await second.dispose()
    }
  })
})
