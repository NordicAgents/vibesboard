// HIGH priority — agent CRUD route auth + TENANT ISOLATION (read + write).
//
// We mock at the service boundary (@vibesboard/agents/server +
// @vibesboard/agents/permissions) rather than the DB layer, because the schema
// module has transitive runtime deps (BUILTIN_AGENT_TOOLS) that break a partial
// DB mock. The route's own `@/lib/auth/route-handler` import is redirected too.
//
// canEditAgent is the cross-tenant write gate: PATCH/DELETE must 403 when a user
// cannot edit an agent owned by another tenant, and must NOT touch the DB.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let authState:
  | { ok: true; user: { id: string; email: string; name: string | null } }
  | { ok: false; response: Response }
vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => authState
}))

// Agent owned by tenant-b / owner-b.
const AGENT = {
  id: 'agent-1',
  tenantId: 'tenant-b',
  userId: 'owner-b',
  name: 'Globex Bot',
  hasAccessPassword: true,
  accessPassword: 'legacy-secret',
  accessPasswordHash: 'database-secret',
  fileKeys: [] as string[]
}
let agent: typeof AGENT | null = AGENT
const getAgentByIdMock = vi.fn(async (_id: string) => agent)
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: (id: string) => getAgentByIdMock(id)
}))

// canEditAgent: only owner-b (member of tenant-b) may edit.
const canEditAgentMock = vi.fn(
  async (ctx: { sessionUserId: string }) => ctx.sessionUserId === 'owner-b'
)
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: (ctx: { sessionUserId: string }) => canEditAgentMock(ctx)
}))

// patchAgentSchema is real (imported via @vibesboard/agents/schema) — but the
// route also imports the DB layer / S3 for PATCH/DELETE writes; stub those so a
// mutation is observable without a real DB or storage.
const updateSpy = vi.fn()
const deleteSpy = vi.fn()
const dbMock = {
  update: () => ({
    set: (v: unknown) => {
      updateSpy(v)
      return { where: async () => undefined }
    }
  }),
  delete: () => ({
    where: async () => {
      deleteSpy()
      return undefined
    }
  }),
  // PATCH wraps its update + recordAgentVersion call in a transaction — run
  // the callback against this same mock so update() is still observable.
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMock)
}
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => dbMock
}))
vi.mock('@vibesboard/adapter-postgres/schema', () => ({ agents: {} }))
vi.mock('@vibesboard/adapter-s3', () => ({
  deleteFile: async () => undefined,
  isCrossTenantFileKey: (key: string, tenantId: string) =>
    key.startsWith('tenants/') && !key.startsWith(`tenants/${tenantId}/`),
  isPermittedAgentFileKey: (
    key: string,
    tenantId: string,
    agentId: string,
    userId: string
  ) =>
    key.startsWith(`tenants/${tenantId}/agents/${agentId}/files/`) ||
    key.startsWith(`${userId}/`)
}))
const getFilesForAgentMock = vi.fn(async (..._args: unknown[]) => [
  {
    id: '10000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-b',
    agentId: 'agent-1',
    fileKey: 'owner/file.txt'
  }
])
vi.mock('@vibesboard/ai/files-store', () => ({
  getFilesForAgent: (...args: unknown[]) => getFilesForAgentMock(...args)
}))
const deleteFileEmbeddingsMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@vibesboard/ai/rag-store', () => ({
  deleteFileEmbeddings: (...args: unknown[]) =>
    deleteFileEmbeddingsMock(...args)
}))
vi.mock('@vibesboard/agents/webhook-utils', () => ({
  assertSafeCallbackUrl: () => undefined
}))
const recordAgentVersionMock = vi.fn(async (..._args: unknown[]) => ({
  versionNo: 1,
  created: true
}))
vi.mock('@vibesboard/agents/versioning', () => ({
  recordAgentVersion: (...args: unknown[]) => recordAgentVersionMock(...args)
}))

const { GET, PATCH, DELETE } = await import('./route.ts')

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const getReq = () => new Request('http://localhost/api/agents/agent-1')
const patchReq = (body: unknown) =>
  new Request('http://localhost/api/agents/agent-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
const member = { id: 'owner-b', email: 'b@x', name: null }
const outsider = { id: 'user-a', email: 'a@x', name: null }

beforeEach(() => {
  authState = { ok: true, user: member }
  agent = AGENT
  getAgentByIdMock.mockClear()
  canEditAgentMock.mockClear()
  updateSpy.mockClear()
  deleteSpy.mockClear()
  getFilesForAgentMock.mockClear()
  deleteFileEmbeddingsMock.mockClear()
  recordAgentVersionMock.mockClear()
})

describe('GET /api/agents/[id]', () => {
  it('returns the agent for an authenticated user', async () => {
    const res = await GET(getReq() as never, ctx('agent-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agent.id).toBe('agent-1')
    expect(body.agent.hasAccessPassword).toBe(true)
    expect(body.agent).not.toHaveProperty('accessPassword')
    expect(body.agent).not.toHaveProperty('accessPasswordHash')
  })

  it('returns 401 when unauthenticated', async () => {
    authState = {
      ok: false,
      response: new Response('Unauthorized', { status: 401 })
    }
    const res = await GET(getReq() as never, ctx('agent-1'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the agent does not exist', async () => {
    agent = null
    const res = await GET(getReq() as never, ctx('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for a user from another tenant', async () => {
    // getAgentById reads through the BYPASSRLS migrate role and filters on the
    // agent id alone, so RLS does not scope this route — the canEditAgent gate
    // is the only thing standing between an outsider and another tenant's
    // agent (whose payload includes accessPasswordHash).
    authState = { ok: true, user: outsider }
    const res = await GET(getReq() as never, ctx('agent-1'))
    expect(res.status).toBe(403)
  })

  it('does not leak the agent body to a user from another tenant', async () => {
    authState = { ok: true, user: outsider }
    const res = await GET(getReq() as never, ctx('agent-1'))
    expect(await res.text()).not.toContain('Globex Bot')
  })
})

describe('PATCH /api/agents/[id]', () => {
  it('updates an agent the user can edit', async () => {
    const res = await PATCH(
      patchReq({ name: 'Renamed' }) as never,
      ctx('agent-1')
    )
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledOnce()
  })

  it('returns 401 when unauthenticated', async () => {
    authState = {
      ok: false,
      response: new Response('Unauthorized', { status: 401 })
    }
    const res = await PATCH(
      patchReq({ name: 'Renamed' }) as never,
      ctx('agent-1')
    )
    expect(res.status).toBe(401)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  // Note: PATCH validates the body with the real patchAgentSchema BEFORE the
  // agent lookup, so this 404 case must send a schema-valid body (name >= 2
  // chars) to reach the lookup and exercise the not-found branch.
  it('returns 404 when the agent does not exist', async () => {
    agent = null
    const res = await PATCH(
      patchReq({ name: 'Renamed' }) as never,
      ctx('missing')
    )
    expect(res.status).toBe(404)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  // TENANT ISOLATION (write): a user who cannot edit this agent (different
  // tenant) must get 403 and the DB update must NOT run.
  it('returns 403 and does NOT update for a user who cannot edit (other tenant)', async () => {
    authState = { ok: true, user: outsider }
    const res = await PATCH(
      patchReq({ name: 'Hijacked' }) as never,
      ctx('agent-1')
    )
    expect(res.status).toBe(403)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a same-tenant key belonging to a different agent', async () => {
    const res = await PATCH(
      patchReq({
        fileKeys: ['tenants/tenant-b/agents/other-agent/files/private.pdf']
      }) as never,
      ctx('agent-1')
    )

    expect(res.status).toBe(400)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/agents/[id]', () => {
  it('deletes file embeddings before deleting the agent', async () => {
    agent = { ...AGENT, fileKeys: ['owner/file.txt'] }
    const res = await DELETE(getReq() as never, ctx('agent-1'))
    expect(res.status).toBe(204)
    expect(getFilesForAgentMock).toHaveBeenCalledWith(
      'agent-1',
      expect.anything()
    )
    expect(deleteFileEmbeddingsMock).toHaveBeenCalledWith(
      'tenant-b',
      '10000000-0000-4000-8000-000000000001',
      expect.anything()
    )
    expect(deleteSpy).toHaveBeenCalledOnce()
  })

  // TENANT ISOLATION (write): cannot delete another tenant's agent.
  it('returns 403 and does NOT delete for a user who cannot edit (other tenant)', async () => {
    authState = { ok: true, user: outsider }
    const res = await DELETE(getReq() as never, ctx('agent-1'))
    expect(res.status).toBe(403)
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
