// HIGH priority — async hook submission: secret auth, hook status, and the
// two guards that make the 202 honest (callback URL reachability, usage
// limit). Both were previously deferred to the background job, so the caller
// got a job id and success for work that could never complete.
//
// Mocked at the service boundary; no DB, no network, and `after` runs the
// background callback inline so nothing escapes the test.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (fn: () => unknown) => void fn }
})

interface Hook {
  id: string
  tenantId: string
  agentId: string
  secretHash: string
  status: string
}
let hook: Hook | null
vi.mock('@vibesboard/agents/hooks', () => ({
  getHookById: async () => hook,
  verifySecret: (raw: string, hash: string) =>
    raw === 'right-secret' && hash === 'hashed',
  recordHookUsage: () => undefined
}))

let agent: { id: string; tenantId: string } | null
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => agent
}))

const createJobMock = vi.fn(async (..._a: unknown[]) => ({ id: 'job-1' }))
const runJobAsyncMock = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@vibesboard/agents/hook-jobs', () => ({
  createJob: (...a: unknown[]) => createJobMock(a),
  runJobAsync: (...a: unknown[]) => runJobAsyncMock(a)
}))

// The real guard — deliberately not stubbed, so the test exercises the actual
// block-list rather than a stand-in for it.
vi.mock('@vibesboard/agents/webhook-utils', async () => {
  const actual = await vi.importActual<
    typeof import('@vibesboard/agents/webhook-utils')
  >('@vibesboard/agents/webhook-utils')
  return { assertSafeCallbackUrl: actual.assertSafeCallbackUrl }
})

let usageAllowed = true
vi.mock('@/lib/usage', () => ({
  checkUsageLimit: async () => ({
    allowed: usageAllowed,
    used: 100,
    limit: 100
  }),
  usageLimitResponse: () =>
    new Response(JSON.stringify({ error: 'usage_limit_reached' }), {
      status: 429,
      headers: { 'content-type': 'application/json' }
    })
}))

import { POST } from './route.ts'

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/hooks/hook-1/async', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  }) as any
}
const params = Promise.resolve({ hookId: 'hook-1' })
const auth = { 'x-hook-secret': 'right-secret' }
const good = {
  message: 'hello',
  callbackUrl: 'https://example.com/callback'
}

beforeEach(() => {
  hook = {
    id: 'hook-1',
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    secretHash: 'hashed',
    status: 'active'
  }
  agent = { id: 'agent-1', tenantId: 'tenant-1' }
  usageAllowed = true
  createJobMock.mockClear()
  runJobAsyncMock.mockClear()
})

describe('POST /api/hooks/[hookId]/async — authentication', () => {
  it('401s without a secret header', async () => {
    const res = await POST(req(good), { params })
    expect(res.status).toBe(401)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('401s on a wrong secret', async () => {
    const res = await POST(req(good, { 'x-hook-secret': 'nope' }), { params })
    expect(res.status).toBe(401)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('401s when the hook is disabled', async () => {
    hook!.status = 'disabled'
    const res = await POST(req(good, auth), { params })
    expect(res.status).toBe(401)
    expect(createJobMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/hooks/[hookId]/async — callback URL guard', () => {
  // Regression: these were accepted with a 202 and only rejected later,
  // inside the background job, where the caller could not see it.
  const blocked = [
    ['loopback', 'http://localhost/cb'],
    ['loopback ip', 'http://127.0.0.1/cb'],
    ['private range', 'http://10.0.0.5/cb'],
    ['link-local', 'http://169.254.169.254/cb'],
    ['non-http scheme', 'ftp://example.com/cb']
  ] as const

  for (const [label, callbackUrl] of blocked) {
    it(`rejects ${label} before creating a job`, async () => {
      const res = await POST(req({ message: 'hi', callbackUrl }, auth), {
        params
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
      expect(createJobMock).not.toHaveBeenCalled()
      expect(runJobAsyncMock).not.toHaveBeenCalled()
    })
  }

  it('accepts a public https callback', async () => {
    const res = await POST(req(good, auth), { params })
    expect(res.status).toBe(202)
    expect(createJobMock).toHaveBeenCalled()
  })
})

describe('POST /api/hooks/[hookId]/async — usage limit', () => {
  it('refuses at submission rather than 202-ing doomed work', async () => {
    usageAllowed = false
    const res = await POST(req(good, auth), { params })
    expect(res.status).toBe(429)
    expect(createJobMock).not.toHaveBeenCalled()
    expect(runJobAsyncMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/hooks/[hookId]/async — validation', () => {
  it('422s on a missing callbackUrl', async () => {
    const res = await POST(req({ message: 'hi' }, auth), { params })
    expect(res.status).toBe(422)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('422s on an empty message', async () => {
    const res = await POST(
      req({ message: '', callbackUrl: 'https://example.com/cb' }, auth),
      { params }
    )
    expect(res.status).toBe(422)
  })

  it('returns the job id on success', async () => {
    const res = await POST(req(good, auth), { params })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ jobId: 'job-1', status: 'pending' })
  })
})
