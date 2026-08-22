// HIGH priority — async hook job polling: secret auth, hook status, and the
// tenant/agent scoping of the job lookup.
//
// These routes had no test coverage at all, which is how a missing
// `status !== 'active'` check shipped: disabling a hook stopped new work but
// left every existing job id readable with the same secret, completed reply
// text included. Mocked at the service boundary, so no DB is needed.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Hook {
  id: string
  tenantId: string
  agentId: string
  secretHash: string
  status: string
}

let hook: Hook | null
const getHookByIdMock = vi.fn(async (_id: string) => hook)
const verifySecretMock = vi.fn(
  (raw: string, hash: string) => raw === 'right-secret' && hash === 'hashed'
)
vi.mock('@vibesboard/agents/hooks', () => ({
  getHookById: (id: string) => getHookByIdMock(id),
  verifySecret: (raw: string, hash: string) => verifySecretMock(raw, hash)
}))

const JOB = {
  id: 'job-1',
  hookId: 'hook-1',
  agentId: 'agent-1',
  status: 'completed',
  reply: 'the answer',
  error: undefined,
  conversationId: 'conv-1',
  callbackStatus: 200,
  callbackAttempts: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  startedAt: undefined,
  completedAt: undefined,
  failedAt: undefined
}
let job: typeof JOB | null = JOB
const getJobMock = vi.fn(async (..._args: unknown[]) => job)
vi.mock('@vibesboard/agents/hook-jobs', () => ({
  getJob: (...args: unknown[]) => getJobMock(...args)
}))

import { GET } from './route.ts'

function req(headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/hooks/hook-1/jobs/job-1', {
    headers
  }) as any
}
const params = Promise.resolve({ hookId: 'hook-1', jobId: 'job-1' })

beforeEach(() => {
  hook = {
    id: 'hook-1',
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    secretHash: 'hashed',
    status: 'active'
  }
  job = JOB
  getHookByIdMock.mockClear()
  verifySecretMock.mockClear()
  getJobMock.mockClear()
})

describe('GET /api/hooks/[hookId]/jobs/[jobId] — authentication', () => {
  it('401s when the secret header is absent', async () => {
    const res = await GET(req(), { params })
    expect(res.status).toBe(401)
    expect(getJobMock).not.toHaveBeenCalled()
  })

  it('401s on an unknown hook', async () => {
    hook = null
    const res = await GET(req({ 'x-hook-secret': 'right-secret' }), { params })
    expect(res.status).toBe(401)
    expect(getJobMock).not.toHaveBeenCalled()
  })

  it('401s on a wrong secret', async () => {
    const res = await GET(req({ 'x-hook-secret': 'wrong-secret' }), { params })
    expect(res.status).toBe(401)
    expect(getJobMock).not.toHaveBeenCalled()
  })

  it('does not leak whether the hook exists (same status for both)', async () => {
    const wrongSecret = await GET(req({ 'x-hook-secret': 'wrong-secret' }), {
      params
    })
    hook = null
    const noHook = await GET(req({ 'x-hook-secret': 'right-secret' }), {
      params
    })
    expect(noHook.status).toBe(wrongSecret.status)
  })
})

describe('GET /api/hooks/[hookId]/jobs/[jobId] — hook status', () => {
  // The regression this file exists for.
  for (const status of ['disabled', 'revoked']) {
    it(`401s and reads no job when the hook is ${status}`, async () => {
      hook!.status = status
      const res = await GET(req({ 'x-hook-secret': 'right-secret' }), {
        params
      })
      expect(res.status).toBe(401)
      expect(getJobMock).not.toHaveBeenCalled()
    })
  }

  it('does not return a completed reply once the hook is disabled', async () => {
    hook!.status = 'disabled'
    const res = await GET(req({ 'x-hook-secret': 'right-secret' }), { params })
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('the answer')
  })
})

describe('GET /api/hooks/[hookId]/jobs/[jobId] — job lookup', () => {
  it('404s when the job does not exist', async () => {
    job = null
    const res = await GET(req({ 'x-hook-secret': 'right-secret' }), { params })
    expect(res.status).toBe(404)
  })

  it('scopes the lookup to the hook tenant and agent', async () => {
    await GET(req({ 'x-hook-secret': 'right-secret' }), { params })
    expect(getJobMock).toHaveBeenCalledWith(
      'tenant-1',
      'agent-1',
      'hook-1',
      'job-1'
    )
  })

  it('returns the job view on success', async () => {
    const res = await GET(req({ 'x-hook-secret': 'right-secret' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      jobId: 'job-1',
      hookId: 'hook-1',
      agentId: 'agent-1',
      status: 'completed',
      reply: 'the answer',
      callbackAttempts: 1
    })
  })

  it('omits internal fields the caller has no business seeing', async () => {
    const res = await GET(req({ 'x-hook-secret': 'right-secret' }), { params })
    const body = await res.json()
    expect(body).not.toHaveProperty('tenantId')
    expect(body).not.toHaveProperty('secretHash')
  })
})
