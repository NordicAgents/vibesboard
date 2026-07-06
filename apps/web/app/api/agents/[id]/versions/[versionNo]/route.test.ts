// MEDIUM priority — single-version route: version-number validation, auth,
// tenant isolation, and that the returned snapshot never carries a password
// hash (config snapshots exclude it by construction — §3.1 of the spec).
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

interface VersionRecord {
  versionNo: number
  source: string
  changeNote: string | null
  restoredFrom: number | null
  createdBy: string | null
  createdAt: Date
  config: Record<string, unknown>
}
let version: VersionRecord | null
const getAgentVersionMock = vi.fn(async (..._args: unknown[]) => version)
vi.mock('@vibesboard/agents/versioning', () => ({
  getAgentVersion: (...args: unknown[]) => getAgentVersionMock(...args)
}))

const { GET } = await import('./route.ts')

const ctx = (id = 'agent-1', versionNo = '2') => ({
  params: Promise.resolve({ id, versionNo })
})
const req = () => new Request('http://localhost/api/agents/agent-1/versions/2')
const member = { id: 'owner-b', email: 'b@x', name: null }
const outsider = { id: 'user-a', email: 'a@x', name: null }

beforeEach(() => {
  authState = { ok: true, user: member }
  agent = AGENT
  version = {
    versionNo: 2,
    source: 'update',
    changeNote: null,
    restoredFrom: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    config: { name: 'Bot', instructions: 'hi' }
  }
  canEditAgentMock.mockClear()
  getAgentVersionMock.mockClear()
})

describe('GET /api/agents/[id]/versions/[versionNo]', () => {
  it('returns 400 for a non-numeric version number and never looks it up', async () => {
    const res = await GET(req() as never, ctx('agent-1', 'abc'))
    expect(res.status).toBe(400)
    expect(getAgentVersionMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a version number less than 1', async () => {
    const res = await GET(req() as never, ctx('agent-1', '0'))
    expect(res.status).toBe(400)
    expect(getAgentVersionMock).not.toHaveBeenCalled()
  })

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
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(404)
  })

  // TENANT ISOLATION (read): a user who cannot edit this agent must get 403
  // and never reach the version store.
  it('returns 403 for a user who cannot edit (other tenant)', async () => {
    authState = { ok: true, user: outsider }
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(403)
    expect(getAgentVersionMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the version does not exist', async () => {
    version = null
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(404)
  })

  it('returns the full config snapshot with no accessPasswordHash field', async () => {
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version.versionNo).toBe(2)
    expect(body.version.config).toEqual({ name: 'Bot', instructions: 'hi' })
    expect(body.version.config.accessPasswordHash).toBeUndefined()
  })
})
