// MEDIUM priority — versions list route: auth, tenant isolation, pagination.
//
// We mock at the service boundary (@vibesboard/agents/server,
// @vibesboard/agents/permissions, @vibesboard/agents/versioning) so no DB is
// needed. getMigrateDb is stubbed just enough to resolve createdBy -> name.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let authState:
  | { ok: true; user: { id: string; email: string; name: string | null } }
  | { ok: false; response: Response }
vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => authState
}))

const AGENT = { id: 'agent-1', tenantId: 'tenant-b', userId: 'owner-b' }
let agent: typeof AGENT | null = AGENT
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => agent
}))

const canEditAgentMock = vi.fn(
  async (ctx: { sessionUserId: string }) => ctx.sessionUserId === 'owner-b'
)
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: (ctx: { sessionUserId: string }) => canEditAgentMock(ctx)
}))

interface VersionRow {
  versionNo: number
  source: string
  changeNote: string | null
  restoredFrom: number | null
  createdBy: string | null
  createdAt: Date
}
let versionRows: VersionRow[] = []
let currentVersion: number | null = 3
const listAgentVersionsMock = vi.fn(
  async (..._args: unknown[]) => versionRows
)
const getAgentCurrentVersionMock = vi.fn(
  async (..._args: unknown[]) => currentVersion
)
vi.mock('@vibesboard/agents/versioning', () => ({
  listAgentVersions: (...args: unknown[]) => listAgentVersionsMock(...args),
  getAgentCurrentVersion: (...args: unknown[]) => getAgentCurrentVersionMock(...args)
}))

vi.mock('@vibesboard/adapter-postgres/schema', () => ({ users: {} }))

const authorNames: Record<string, string> = { 'user-1': 'Alice' }
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => ({
    select: () => ({
      from: () => ({
        where: async () =>
          Object.entries(authorNames).map(([id, name]) => ({ id, name }))
      })
    })
  })
}))

const { GET } = await import('./route.ts')

const ctx = (id = 'agent-1') => ({ params: Promise.resolve({ id }) })
const req = (url = 'http://localhost/api/agents/agent-1/versions') =>
  new Request(url)
const member = { id: 'owner-b', email: 'b@x', name: null }
const outsider = { id: 'user-a', email: 'a@x', name: null }

beforeEach(() => {
  authState = { ok: true, user: member }
  agent = AGENT
  versionRows = [
    {
      versionNo: 3,
      source: 'update',
      changeNote: 'tweak',
      restoredFrom: null,
      createdBy: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00Z')
    }
  ]
  currentVersion = 3
  canEditAgentMock.mockClear()
  listAgentVersionsMock.mockClear()
  getAgentCurrentVersionMock.mockClear()
})

describe('GET /api/agents/[id]/versions', () => {
  it('returns 401 when unauthenticated', async () => {
    authState = {
      ok: false,
      response: new Response('Unauthorized', { status: 401 })
    }
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when the agent does not exist', async () => {
    agent = null
    const res = await GET(req() as never, ctx('missing'))
    expect(res.status).toBe(404)
  })

  // TENANT ISOLATION (read): a user who cannot edit this agent must get 403
  // and never reach the versions store.
  it('returns 403 for a user who cannot edit (other tenant)', async () => {
    authState = { ok: true, user: outsider }
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(403)
    expect(listAgentVersionsMock).not.toHaveBeenCalled()
  })

  it('lists versions newest-first with resolved author names and isCurrent flag, no config body', async () => {
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.currentVersion).toBe(3)
    expect(body.versions).toHaveLength(1)
    expect(body.versions[0]).toMatchObject({
      versionNo: 3,
      source: 'update',
      createdByName: 'Alice',
      isCurrent: true
    })
    expect(body.versions[0].config).toBeUndefined()
  })

  it('falls back to safe page/limit defaults when query params are non-numeric', async () => {
    const res = await GET(
      req(
        'http://localhost/api/agents/agent-1/versions?page=abc&limit=xyz'
      ) as never,
      ctx()
    )
    expect(res.status).toBe(200)
    expect(listAgentVersionsMock).toHaveBeenCalledWith('agent-1', {
      limit: 50,
      offset: 0
    })
  })

  it('clamps limit to 100 and computes offset from page', async () => {
    const res = await GET(
      req(
        'http://localhost/api/agents/agent-1/versions?page=3&limit=500'
      ) as never,
      ctx()
    )
    expect(res.status).toBe(200)
    expect(listAgentVersionsMock).toHaveBeenCalledWith('agent-1', {
      limit: 100,
      offset: 200
    })
  })
})
