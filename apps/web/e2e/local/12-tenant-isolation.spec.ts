/**
 * Section 12 — Tenant isolation (cross-tenant IDOR guard)
 *
 * Every other spec in this suite runs as a single user, so nothing proved that
 * one tenant cannot reach another's data. That gap hid a family of real bugs:
 * several routes called requireAuth() and then resolved the agent with
 * getAgentById(), which reads through the BYPASSRLS migrate role and filters on
 * the agent id alone — authentication without authorization, and RLS cannot
 * scope it.
 *
 * The owner (E2E_USER) creates an agent; the outsider (E2E_OUTSIDER, a member
 * of no tenant the owner owns) must be refused by every route below. Each test
 * asserts a non-2xx AND that the response body does not carry the payload, so a
 * route that "fails open" with 200-and-empty cannot pass.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test'
import { BASE_URL, OUTSIDER_STATE, STORAGE_STATE } from '../constants.ts'

const SECRET_NAME = `Isolation Victim ${Date.now()}`
const SECRET_INSTRUCTIONS = 'TOPSECRET-cross-tenant-canary-string'

let agentId: string
let conversationId: string | undefined

test.beforeAll(async () => {
  // ── Owner: create an agent with a recognisable canary in it ───────────────
  const owner = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    const res = await owner.post('/api/agents', {
      data: { name: SECRET_NAME, instructions: SECRET_INSTRUCTIONS },
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBeLessThan(300)
    const body = await res.json()
    agentId = body.agent?.id ?? body.id
    expect(agentId).toBeTruthy()

    // Seed one conversation so the transcript routes have something to leak.
    const ask = await owner.post(`/api/agents/${agentId}/conversations/ask`, {
      data: { question: 'canary question' },
      failOnStatusCode: false,
    })
    expect(ask.status(), `ask failed: ${await ask.text()}`).toBeLessThan(300)

    // Read the id back off the list rather than guessing the ask response
    // shape — the list route is the contract the isolation test cares about.
    const list = await owner.get(`/api/agents/${agentId}/conversations`)
    expect(list.ok()).toBeTruthy()
    const { conversations } = await list.json()
    conversationId = conversations?.[0]?.id
    expect(
      conversationId,
      'expected the seeded conversation to be listable',
    ).toBeTruthy()
  } finally {
    await owner.dispose()
  }
})

test.afterAll(async () => {
  const owner = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
  })
  try {
    if (agentId) {
      await owner.delete(`/api/agents/${agentId}`, { failOnStatusCode: false })
    }
  } finally {
    await owner.dispose()
  }
})

// Everything below runs as the outsider.
test.use({ storageState: OUTSIDER_STATE })

test.describe('Tenant isolation — the outsider is authenticated', () => {
  test('the outsider session is valid (so 4xx below means denied, not logged out)', async ({
    request,
  }) => {
    // Guards against the whole file passing vacuously because the storage state
    // is stale: this call must succeed for the same session that is refused
    // everywhere else.
    const res = await request.get('/api/agents', { failOnStatusCode: false })
    expect(res.status()).toBe(200)
  })

  test("the outsider cannot see the owner's agent in its own list", async ({
    request,
  }) => {
    const res = await request.get('/api/agents')
    expect(res.ok()).toBeTruthy()
    const body = await res.text()
    expect(body).not.toContain(agentId)
    expect(body).not.toContain(SECRET_NAME)
  })
})

test.describe('Tenant isolation — agent read', () => {
  test('GET /api/agents/[id] refuses a cross-tenant read', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain(SECRET_INSTRUCTIONS)
  })

  test('GET /api/agents/[id]/versions refuses a cross-tenant read', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/versions`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
  })
})

test.describe('Tenant isolation — conversations', () => {
  test('GET conversations list refuses a cross-tenant read', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/conversations`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain('canary question')
  })

  test('GET a single conversation refuses a cross-tenant read', async ({
    request,
  }) => {
    const res = await request.get(
      `/api/agents/${agentId}/conversations/${conversationId}`,
      { failOnStatusCode: false },
    )
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain('canary question')
  })
})

test.describe('Tenant isolation — file storage', () => {
  const FOREIGN_KEY = 'some-other-tenant/private-document.pdf'

  test('download-url refuses to sign a URL for a key it does not own', async ({
    request,
  }) => {
    const res = await request.get(
      `/api/agents/${agentId}/files/download-url?fileKey=${encodeURIComponent(FOREIGN_KEY)}`,
      { failOnStatusCode: false },
    )
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain('http')
  })

  test('files/delete refuses to delete a key it does not own', async ({
    request,
  }) => {
    const res = await request.post(`/api/agents/${agentId}/files/delete`, {
      data: { fileKey: FOREIGN_KEY },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
  })
})

test.describe('Tenant isolation — writes', () => {
  test('PATCH refuses a cross-tenant write', async ({ request }) => {
    const res = await request.patch(`/api/agents/${agentId}`, {
      data: { name: 'pwned' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
  })

  test('DELETE refuses a cross-tenant delete, and the agent survives', async ({
    request,
  }) => {
    const res = await request.delete(`/api/agents/${agentId}`, {
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)

    // Prove the refusal was real by reading it back as the owner.
    const owner = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      storageState: STORAGE_STATE,
    })
    try {
      const check = await owner.get(`/api/agents/${agentId}`, {
        failOnStatusCode: false,
      })
      expect(check.status()).toBe(200)
      expect((await check.json()).agent.name).toBe(SECRET_NAME)
    } finally {
      await owner.dispose()
    }
  })
})

test.describe('Admin surface is superadmin-only', () => {
  const ADMIN_ROUTES = [
    '/api/admin/tenants',
    '/api/admin/platform-branding',
  ]

  for (const route of ADMIN_ROUTES) {
    test(`GET ${route} refuses a non-superadmin`, async ({ request }) => {
      const res = await request.get(route, { failOnStatusCode: false })
      expect(res.status()).toBe(403)
    })
  }

  test('POST /api/admin/tenants refuses a non-superadmin', async ({
    request,
  }) => {
    const res = await request.post('/api/admin/tenants', {
      data: { name: 'Outsider Tenant', slug: `outsider-${Date.now()}` },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(403)
  })
})
