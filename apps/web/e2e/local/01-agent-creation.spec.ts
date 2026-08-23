/**
 * Section 1 — Agent Creation
 *
 * Every assertion here is pinned to something only the page/route under test
 * can produce. Notably:
 *   - the list page is asserted with a fixture agent guaranteed to exist, so the
 *     empty state (which renders a *second* "Create Agent" link) cannot race the
 *     locator, and the CTA count is deterministic
 *   - the creator API is asserted against the deterministic mock reply, not just
 *     `res.ok()` — `toTextStreamResponse()` commits a 200 before the provider is
 *     ever contacted, so a 200 alone proves nothing about the model round-trip
 *   - POST /api/agents is asserted to take the tenant from the session, never
 *     from the request body (the body field is silently stripped by Zod)
 *   - the detail page is asserted by HTTP status + the agent's own heading; the
 *     404 (notFound()) and the error boundary both render at the *same URL*, so
 *     a URL assertion cannot see them
 *
 * The agent-creator's `create_agent` tool — the LLM-driven persistence path — is
 * covered: e2e/mock-openai.mjs emits a real tool call when a prompt contains
 * E2E_TRIGGER_CREATE_AGENT, so `execute` runs and the `~~~agentcreated~~~`
 * marker is asserted end to end. The preview-panel "Create Agent" button
 * exercises the other half of the flow (creator page → agent persisted →
 * success screen).
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { BASE_URL, OUTSIDER_STATE, STORAGE_STATE } from '../constants.ts'

// e2e/mock-openai.mjs always replies with exactly this (MOCK_OPENAI_REPLY default).
const STUB_REPLY = 'This is a deterministic E2E stubbed reply from the mock model.'

// components/agents/agent-creator-chat.tsx → STARTER_PROMPTS[0]
const STARTER_PROMPT = 'Customer support agent for my business'

// The fixture agent that keeps /agents non-empty for the whole file.
const LIST_AGENT_NAME = `E2E List Fixture ${Date.now()}`
const LIST_AGENT_INSTRUCTIONS =
  'Fixture agent that keeps the agents list non-empty for the E2E list assertions.'

test.use({ storageState: STORAGE_STATE })

let tenantId: string
let outsiderTenantId: string
let listAgentId: string

test.beforeAll(async () => {
  const owner = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    const tenantRes = await owner.get('/api/user/active-tenant', {
      failOnStatusCode: false,
    })
    expect(tenantRes.status(), await tenantRes.text()).toBe(200)
    tenantId = (await tenantRes.json()).tenant_id
    expect(tenantId).toBeTruthy()

    const createRes = await owner.post('/api/agents', {
      data: { name: LIST_AGENT_NAME, instructions: LIST_AGENT_INSTRUCTIONS },
      failOnStatusCode: false,
    })
    expect(createRes.status(), await createRes.text()).toBe(200)
    listAgentId = (await createRes.json()).agent?.id
    expect(listAgentId).toBeTruthy()
  } finally {
    await owner.dispose()
  }

  // A tenant that genuinely exists and that E2E_USER is *not* a member of.
  const outsider = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: OUTSIDER_STATE,
  })
  try {
    const res = await outsider.get('/api/user/active-tenant', {
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    outsiderTenantId = (await res.json()).tenant_id
    expect(outsiderTenantId).toBeTruthy()
    expect(outsiderTenantId).not.toBe(tenantId)
  } finally {
    await outsider.dispose()
  }
})

test.afterAll(async () => {
  const owner = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    if (listAgentId) {
      await owner.delete(`/api/agents/${listAgentId}`, {
        failOnStatusCode: false,
      })
    }
  } finally {
    await owner.dispose()
  }
})

test.describe('Agent Creation — list page', () => {
  test('the list renders the agent card and exactly one Create Agent CTA', async ({
    page,
  }) => {
    const res = await page.goto('/agents')
    expect(res?.status()).toBe(200)

    // The sidebar links to the same href, so filter on the instructions — only
    // the grid card (app/agents/page.tsx CardDescription) renders those.
    const card = page
      .locator(`a[href="/agents/${listAgentId}?tab=configure"]`)
      .filter({ hasText: LIST_AGENT_INSTRUCTIONS })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(LIST_AGENT_NAME)

    // Copy that only /agents renders (PageHeader description).
    await expect(
      page.getByText('Build Agents for Vibing with People'),
    ).toBeVisible()

    // With the list loaded and non-empty the EmptyState CTA must not exist, so
    // there is exactly one "Create Agent" link. Two means the empty state
    // rendered anyway (and every locator on this page is ambiguous).
    const cta = page.getByRole('link', { name: 'Create Agent' })
    await expect(cta).toHaveCount(1)
    await expect(cta).toHaveAttribute('href', '/agents/create-chat')
  })

  test('the Create Agent CTA opens the AI creator', async ({ page }) => {
    await page.goto('/agents')

    // Wait for the list to settle first, otherwise the CTA count is racing the
    // loading skeleton → empty-state transition.
    await expect(
      page
        .locator(`a[href="/agents/${listAgentId}?tab=configure"]`)
        .filter({ hasText: LIST_AGENT_INSTRUCTIONS }),
    ).toHaveCount(1)

    const cta = page.getByRole('link', { name: 'Create Agent' })
    await expect(cta).toHaveCount(1)
    await cta.click()

    await expect(page).toHaveURL(/\/agents\/create-chat$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Build Your Agent' }),
    ).toBeVisible()
  })
})

test.describe('Agent Creation — creator page', () => {
  test('the creator renders the chat shell, starter prompts and live preview', async ({
    page,
  }) => {
    const res = await page.goto('/agents/create-chat')
    expect(res?.status()).toBe(200)

    await expect(
      page.getByRole('heading', { level: 1, name: 'Build Your Agent' }),
    ).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()

    // The four STARTER_PROMPTS are the only way to start the conversation
    // without typing; each one is an append() trigger.
    const suggestions = page
      .locator('[aria-label="Quick suggestions"]')
      .getByRole('button')
    await expect(suggestions).toHaveCount(4)
    await expect(suggestions.first()).toHaveText(STARTER_PROMPT)

    // The live preview panel holds the three fields required to create.
    await expect(page.getByPlaceholder('e.g., Support Assistant')).toBeVisible()
    await expect(
      page.getByPlaceholder('Describe how the agent should behave...'),
    ).toBeVisible()
    await expect(
      page.getByPlaceholder('e.g., Hi! How can I help you today?'),
    ).toBeVisible()
  })

  test('sending a starter prompt streams the model reply into the transcript', async ({
    page,
  }) => {
    await page.goto('/agents/create-chat')

    const suggestion = page.getByRole('button', { name: STARTER_PROMPT })
    await expect(suggestion).toBeVisible()

    const creatorCall = page.waitForResponse(
      r =>
        r.url().includes('/api/agent-creator') &&
        r.request().method() === 'POST',
    )
    await suggestion.click()
    const res = await creatorCall
    expect(res.status()).toBe(200)

    // The deterministic mock reply has to reach the DOM: this is what proves the
    // stream was consumed, not just that a 200 status line was written.
    await expect(page.getByText(STUB_REPLY)).toBeVisible({ timeout: 30_000 })
  })

  test('the builder preview creates and persists an agent from the creator page', async ({
    request,
    page,
  }) => {
    const name = `E2E Builder Agent ${Date.now()}`
    const instructions =
      'Created from the agent-creator preview panel during the E2E run.'
    const greeting = 'Hi! I am the E2E builder agent.'

    await page.goto('/agents/create-chat')
    await page.getByPlaceholder('e.g., Support Assistant').fill(name)
    await page
      .getByPlaceholder('Describe how the agent should behave...')
      .fill(instructions)
    await page
      .getByPlaceholder('e.g., Hi! How can I help you today?')
      .fill(greeting)

    // No chat messages yet, so the preview panel holds the only Create button.
    const createBtn = page.getByRole('button', { name: 'Create Agent' })
    await expect(createBtn).toBeEnabled()

    const createCall = page.waitForResponse(
      r => r.url().endsWith('/api/agents') && r.request().method() === 'POST',
    )
    await createBtn.click()
    const createRes = await createCall
    expect(createRes.status()).toBe(200)
    const createdId = (await createRes.json()).agent?.id
    expect(createdId).toBeTruthy()

    try {
      // The success screen replaces the builder and names the new agent.
      await expect(
        page.getByRole('heading', { name: 'Your agent is ready!' }),
      ).toBeVisible()
      await expect(page.getByText(`${name} has been created`)).toBeVisible()

      // …and the agent is really persisted, with the values typed into the form.
      const read = await request.get(`/api/agents/${createdId}`, {
        failOnStatusCode: false,
      })
      expect(read.status()).toBe(200)
      const { agent } = await read.json()
      expect(agent.name).toBe(name)
      expect(agent.instructions).toBe(instructions)
      expect(agent.greetingText).toBe(greeting)
    } finally {
      await request.delete(`/api/agents/${createdId}`, {
        failOnStatusCode: false,
      })
    }
  })
})

test.describe('Agent Creation — creator API', () => {
  test('the create_agent tool actually persists an agent', async ({ request }) => {
    // The only code path that turns a creator conversation into a real agent.
    // It was unreachable in E2E until e2e/mock-openai.mjs learned to emit a
    // tool call: the stub only ever returned prose, so tool.execute() never
    // ran and the whole branch — slug generation, upsertAgentSchema.parse of
    // the model's arguments, the insert, the ~~~agentcreated~~~ marker — was
    // untested. TOOL_CALL_TRIGGER opts this one request into that behaviour.
    // pagination.total, not agents.length — the list endpoint defaults to
    // limit=9, so the array caps out and would hide the new row.
    const before = await request.get('/api/agents')
    expect(before.ok()).toBeTruthy()
    const countBefore = (await before.json()).pagination.total

    const res = await request.post('/api/agent-creator', {
      data: {
        messages: [
          { role: 'user', content: 'E2E_TRIGGER_CREATE_AGENT — create it now' },
        ],
        fileKeys: [],
        fileNames: [],
      },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)

    // The success marker must reach the client. tool.execute() returns it as a
    // *tool result*, which a single-step text stream never turns into assistant
    // text — so this body used to come back EMPTY while the agent was created,
    // leaving components/agents/agent-creator-chat.tsx (streamProtocol: 'text',
    // parses ~~~agentcreated~~~ in onFinish) with nothing to act on: no success
    // screen, no redirect. The route now appends the tool outcome to the stream.
    const body = await res.text()
    expect(body).toContain('~~~agentcreated')
    const markerId = JSON.parse(
      body.split('~~~agentcreated')[1].split('~~~')[0].trim()
    ).id
    expect(markerId).toBeTruthy()

    const after = await request.get('/api/agents?page=1&limit=100')
    expect(after.ok()).toBeTruthy()
    const afterBody = await after.json()
    expect(afterBody.pagination.total).toBe(countBefore + 1)

    const created = (afterBody.agents ?? []).find((a: { name: string }) =>
      a.name.startsWith('E2E Tool-Created Agent'),
    )
    expect(created, 'the tool call should have persisted an agent').toBeTruthy()
    // The id in the marker must be the row that was actually written.
    expect(created.id).toBe(markerId)

    try {
      const read = await request.get(`/api/agents/${created.id}`)
      expect(read.status()).toBe(200)
      expect((await read.json()).agent.instructions).toContain(
        'create_agent tool',
      )
    } finally {
      await request.delete(`/api/agents/${created.id}`, {
        failOnStatusCode: false,
      })
    }
  })

  test('POST /api/agent-creator streams the deterministic model reply', async ({
    request,
  }) => {
    const res = await request.post('/api/agent-creator', {
      // The handler destructures only messages/previewToken/fileKeys/fileNames
      // and resolves the tenant from the session cookie — a tenant_id in the
      // body would be silently ignored, so it is deliberately not sent.
      data: {
        messages: [
          { role: 'user', content: 'I need a helpful customer support agent' },
        ],
        fileKeys: [],
        fileNames: [],
      },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(200)
    // toTextStreamResponse() writes the 200 before the provider is contacted,
    // so the body — not the status — is the evidence the model round-tripped.
    expect(await res.text()).toContain(STUB_REPLY)
  })

  test('POST /api/agent-creator refuses an unauthenticated caller', async () => {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: undefined })
    try {
      const res = await anon.post('/api/agent-creator', {
        data: { messages: [{ role: 'user', content: 'hello' }] },
        headers: { 'Content-Type': 'application/json' },
        failOnStatusCode: false,
      })
      expect(res.status()).toBe(401)
      expect(await res.text()).not.toContain(STUB_REPLY)
    } finally {
      await anon.dispose()
    }
  })
})

test.describe('Agent Creation — agents API', () => {
  test('POST /api/agents persists the agent into the session tenant and lists it', async ({
    request,
  }) => {
    const name = `E2E API Agent ${Date.now()}`
    const instructions = 'You are a helpful E2E test agent created over the API.'

    const createRes = await request.post('/api/agents', {
      data: { name, instructions },
      failOnStatusCode: false,
    })
    expect(createRes.status(), await createRes.text()).toBe(200)
    const { agent } = await createRes.json()
    expect(agent?.id).toBeTruthy()

    try {
      expect(agent.name).toBe(name)
      expect(agent.instructions).toBe(instructions)
      expect(agent.tenantId).toBe(tenantId)
      // The slug is generated server-side and is what the public URL uses.
      expect(agent.agentUrl).toBeTruthy()

      const list = await request.get(
        `/api/agents?tenant_id=${tenantId}&limit=50`,
        { failOnStatusCode: false },
      )
      expect(list.status()).toBe(200)
      const { agents } = await list.json()
      expect(agents.map((a: { id: string }) => a.id)).toContain(agent.id)
      // Everything the tenant-scoped list returns belongs to that tenant.
      expect(
        agents.every((a: { tenantId: string }) => a.tenantId === tenantId),
      ).toBe(true)
    } finally {
      await request.delete(`/api/agents/${agent.id}`, {
        failOnStatusCode: false,
      })
    }
  })

  test('POST /api/agents ignores a client-supplied tenantId', async ({
    request,
  }) => {
    const name = `E2E Tenant Spoof ${Date.now()}`
    const res = await request.post('/api/agents', {
      // upsertAgentSchema has no tenantId key, and the handler resolves the
      // tenant from the session — a caller must not be able to plant an agent
      // in a workspace it is not a member of.
      data: {
        name,
        instructions: 'A spoofed tenantId must not move this agent.',
        tenantId: outsiderTenantId,
      },
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    const { agent } = await res.json()
    expect(agent?.id).toBeTruthy()

    try {
      expect(agent.tenantId).toBe(tenantId)
      expect(agent.tenantId).not.toBe(outsiderTenantId)
    } finally {
      await request.delete(`/api/agents/${agent.id}`, {
        failOnStatusCode: false,
      })
    }
  })

  test('POST /api/agents rejects a too-short name/instructions with 400', async ({
    request,
  }) => {
    // name min 2, instructions min 10 (packages/agents/src/schema.ts).
    const res = await request.post('/api/agents', {
      data: { name: 'x', instructions: 'too short' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(Array.isArray(body.issues)).toBe(true)
    const paths = body.issues.flatMap((i: { path: string[] }) => i.path)
    expect(paths).toContain('name')
    expect(paths).toContain('instructions')
  })

  test('GET /api/agents refuses a tenant_id the caller is not a member of', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents?tenant_id=${outsiderTenantId}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain('"agents"')
  })
})

test.describe('Agent Creation — detail page', () => {
  test('the detail page loads the agent that was just created', async ({
    request,
    page,
  }) => {
    const name = `E2E Detail Agent ${Date.now()}`
    const createRes = await request.post('/api/agents', {
      data: {
        name,
        instructions: 'Detail page agent instructions for the E2E run.',
      },
      failOnStatusCode: false,
    })
    expect(createRes.status(), await createRes.text()).toBe(200)
    const id = (await createRes.json()).agent?.id
    expect(id).toBeTruthy()

    try {
      // notFound() and the route error boundary both render at this same URL,
      // so the HTTP status is the only thing that separates them.
      const res = await page.goto(`/agents/${id}?tab=configure`)
      expect(res?.status()).toBe(200)

      // Only the loaded agent produces this heading (AgentDashboardTabs h2).
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
      // app/agents/[id]/error.tsx must not have caught anything.
      await expect(page.getByText('Could not load this agent')).toHaveCount(0)
    } finally {
      await request.delete(`/api/agents/${id}`, { failOnStatusCode: false })
    }
  })

  test('an agent id that does not exist renders a 404, not the agent shell', async ({
    page,
  }) => {
    const missingId = '00000000-0000-4000-8000-000000000000'
    await page.goto(`/agents/${missingId}`)

    // The HTTP status is deliberately not asserted. app/agents/[id]/layout.tsx
    // does call notFound() for a missing agent, but the App Router has already
    // flushed the streamed shell by then, so the response is committed as 200.
    // What the user sees is the contract worth guarding:
    await expect(
      page.getByRole('heading', { level: 1, name: '404', exact: true }),
    ).toBeVisible()
    // Neither the chat shell nor the error boundary — a plain not-found.
    await expect(page.getByTestId('chat-input')).toHaveCount(0)
    await expect(page.getByText('Could not load this agent')).toHaveCount(0)
  })
})
