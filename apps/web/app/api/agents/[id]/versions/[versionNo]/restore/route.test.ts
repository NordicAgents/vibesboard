// HIGH priority — restore route: version validation, auth, tenant isolation,
// error mapping (not-found -> 404, other -> 500), and file reconciliation
// (re-added keys that still exist in storage get reprocessed; missing ones
// are reported as warnings, not silently dropped).
import { describe, it, expect, beforeEach, vi } from 'vitest'

let authState:
  | { ok: true; user: { id: string; email: string; name: string | null } }
  | { ok: false; response: Response }
vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => authState
}))

const AGENT = {
  id: 'agent-1',
  tenantId: 'tenant-b',
  userId: 'owner-b',
  fileKeys: [] as string[]
}
let agent: typeof AGENT | null = AGENT
const getAgentByIdMock = vi.fn(async (_id: string) => agent)
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: (id: string) => getAgentByIdMock(id)
}))

const canEditAgentMock = vi.fn(
  async (ctx: { sessionUserId: string }) => ctx.sessionUserId === 'owner-b'
)
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: (ctx: { sessionUserId: string }) => canEditAgentMock(ctx)
}))

interface RestoreOk {
  versionNo: number
  snapshot: { fileKeys: string[] }
  previousFileKeys: string[]
}
let restoreResult: RestoreOk | { error: Error }
const restoreAgentVersionMock = vi.fn(async (..._args: unknown[]) => {
  if (restoreResult && 'error' in restoreResult) throw restoreResult.error
  return restoreResult as RestoreOk
})
vi.mock('@vibesboard/agents/versioning', () => ({
  restoreAgentVersion: (...args: unknown[]) => restoreAgentVersionMock(...args)
}))

const createFilesMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@vibesboard/agents/file-processing', () => ({
  createAgentFilesAndTriggerProcessing: (...args: unknown[]) =>
    createFilesMock(...args)
}))

let knownFiles: Array<{ fileKey: string }> = []
const getFilesByKeysMock = vi.fn(async (..._args: unknown[]) => knownFiles)
vi.mock('@vibesboard/ai/files-store', () => ({
  getFilesByKeys: (...args: unknown[]) => getFilesByKeysMock(...args)
}))

let existingKeys = new Set<string>()
const fileExistsMock = vi.fn(async (key: string) => existingKeys.has(key))
vi.mock('@vibesboard/adapter-s3', () => ({
  fileExists: (key: string) => fileExistsMock(key),
  isCrossTenantFileKey: (key: string, tenantId: string) =>
    key.startsWith('tenants/') && !key.startsWith(`tenants/${tenantId}/`)
}))

const { POST } = await import('./route.ts')

const ctx = (id = 'agent-1', versionNo = '2') => ({
  params: Promise.resolve({ id, versionNo })
})
const req = () =>
  new Request('http://localhost/api/agents/agent-1/versions/2/restore', {
    method: 'POST'
  })
const member = { id: 'owner-b', email: 'b@x', name: null }
const outsider = { id: 'user-a', email: 'a@x', name: null }

beforeEach(() => {
  authState = { ok: true, user: member }
  agent = AGENT
  restoreResult = {
    versionNo: 4,
    snapshot: { fileKeys: [] },
    previousFileKeys: []
  }
  knownFiles = []
  existingKeys = new Set()
  getAgentByIdMock.mockClear()
  canEditAgentMock.mockClear()
  restoreAgentVersionMock.mockClear()
  createFilesMock.mockClear()
  getFilesByKeysMock.mockClear()
  fileExistsMock.mockClear()
})

describe('POST /api/agents/[id]/versions/[versionNo]/restore', () => {
  it('returns 400 for a non-numeric version number and never calls restore', async () => {
    const res = await POST(req() as never, ctx('agent-1', 'abc'))
    expect(res.status).toBe(400)
    expect(restoreAgentVersionMock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    authState = {
      ok: false,
      response: new Response('Unauthorized', { status: 401 })
    }
    const res = await POST(req() as never, ctx())
    expect(res.status).toBe(401)
    expect(restoreAgentVersionMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the agent does not exist', async () => {
    agent = null
    const res = await POST(req() as never, ctx())
    expect(res.status).toBe(404)
    expect(restoreAgentVersionMock).not.toHaveBeenCalled()
  })

  // TENANT ISOLATION (write): a user who cannot edit this agent must get 403
  // and restore must NOT run.
  it('returns 403 and does NOT restore for a user who cannot edit (other tenant)', async () => {
    authState = { ok: true, user: outsider }
    const res = await POST(req() as never, ctx())
    expect(res.status).toBe(403)
    expect(restoreAgentVersionMock).not.toHaveBeenCalled()
  })

  it('returns 404 when restoreAgentVersion reports the version was not found', async () => {
    restoreResult = {
      error: new Error(
        'restoreAgentVersion: version 99 not found for agent agent-1'
      )
    }
    const res = await POST(req() as never, ctx())
    expect(res.status).toBe(404)
  })

  it('returns 500 for any other restore failure', async () => {
    restoreResult = { error: new Error('db exploded') }
    const res = await POST(req() as never, ctx())
    expect(res.status).toBe(500)
  })

  it('restores, reprocesses re-added files that still exist in storage, and warns about ones that are missing', async () => {
    restoreResult = {
      versionNo: 4,
      snapshot: { fileKeys: ['known-key', 'present-key', 'missing-key'] },
      previousFileKeys: ['known-key']
    }
    knownFiles = [{ fileKey: 'known-key' }]
    existingKeys = new Set(['present-key'])

    const res = await POST(req() as never, ctx())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.restoredFrom).toBe(2)
    expect(body.versionNo).toBe(4)
    // already-known key is never re-checked against storage
    expect(fileExistsMock).not.toHaveBeenCalledWith('known-key')
    expect(createFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileKeys: ['present-key'] })
    )
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toContain('missing-key')
  })

  it('skips file reconciliation entirely when the restore re-adds no files', async () => {
    restoreResult = {
      versionNo: 5,
      snapshot: { fileKeys: ['already-there'] },
      previousFileKeys: ['already-there']
    }
    const res = await POST(req() as never, ctx())
    expect(res.status).toBe(200)
    expect(getFilesByKeysMock).not.toHaveBeenCalled()
    expect(createFilesMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.warnings).toEqual([])
  })
})
