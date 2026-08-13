import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const events: string[] = []
const reserveAgentResponseSlot = vi.fn(async () => {
  events.push('reserve')
  return true
})
const incrementAgentResponseCount = vi.fn(async () => undefined)
const runAgentStream = vi.fn(async () => {
  events.push('model')
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    }
  })
})
const consumeRateLimit = vi.fn(async () => ({
  allowed: true,
  limit: 20,
  remaining: 19,
  resetAt: new Date('2026-08-12T12:01:00.000Z')
}))

const agent = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  name: 'Public agent',
  slug: 'public-agent',
  allowAnonymous: true,
  maxAgentResponses: 10,
  totalResponseCount: 9,
  maxResponses: null,
  handoffTargets: [],
  memoryEnabled: false,
  mode: 'provider'
}

vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: vi.fn(async () => agent),
  getAgentNamesByTenant: vi.fn(async () => ({}))
}))
vi.mock('@vibesboard/agents/schema', () => ({
  publicAgentChatRequestSchema: { parse: (value: unknown) => value }
}))
vi.mock('@vibesboard/agents/conversations', () => ({
  ensureConversation: vi.fn(async () => ({
    id: '00000000-0000-4000-8000-000000000004',
    responseCounts: {},
    summary: null,
    summaryResponseCount: 0
  })),
  updateConversationMessages: vi.fn(),
  getConversation: vi.fn(),
  recordConversationHandoff: vi.fn()
}))
vi.mock('@vibesboard/agents/auto-summarize', () => ({
  maybeAutoSummarize: vi.fn()
}))
vi.mock('@vibesboard/ai/runtime', () => ({ runAgentStream }))
vi.mock('@/lib/agent-cookies', () => ({
  ensureExternalSessionId: vi.fn(async () => 'external-session')
}))
vi.mock('@/lib/access-gate', () => ({
  hasValidAccessCookie: vi.fn(async () => false)
}))
vi.mock('@vibesboard/utils', () => ({ nanoid: () => 'generated-id' }))
vi.mock('@vibesboard/ai/completion', () => ({
  detectCompletionMarker: vi.fn(),
  extractHandoffTarget: vi.fn(),
  stripCompletionMarkers: (value: string) => value,
  wrapStreamWithCompletionDetection: (stream: ReadableStream) => stream
}))
vi.mock('@vibesboard/agents/notifications', () => ({
  dispatchAgentNotification: vi.fn(),
  mapCompletionToEvent: vi.fn()
}))
vi.mock('@vibesboard/ai/handoff', () => ({
  validateHandoff: vi.fn(),
  buildHandoffContext: vi.fn()
}))
vi.mock('@vibesboard/ai/agent-memory', () => ({
  recallMemory: vi.fn(),
  ingestMemory: vi.fn()
}))
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: vi.fn()
}))
vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  recordUsage: vi.fn(),
  usageLimitResponse: vi.fn()
}))
vi.mock('@vibesboard/policy/rate-limit', () => ({
  consumeRateLimit,
  getRateLimitSalt: () => 'test-rate-limit-salt-that-is-long-enough',
  getTrustedClientAddress: () => '203.0.113.10'
}))
vi.mock('@vibesboard/agents/limits', () => ({
  incrementAgentResponseCount,
  reserveAgentResponseSlot
}))
vi.mock('@vibesboard/adapter-openai', () => ({
  OPENAI_CHAT_MODEL: 'test-model'
}))

const { POST } = await import('./route.ts')

function request() {
  return new NextRequest('http://localhost/api/public/agents/agent/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ id: 'm1', role: 'user', content: 'hello' }]
    })
  })
}

describe('public chat lifetime cap', () => {
  beforeEach(() => {
    events.length = 0
    reserveAgentResponseSlot.mockReset()
    reserveAgentResponseSlot.mockImplementation(async () => {
      events.push('reserve')
      return true
    })
    runAgentStream.mockClear()
    incrementAgentResponseCount.mockClear()
    consumeRateLimit.mockReset()
    consumeRateLimit.mockResolvedValue({
      allowed: true,
      limit: 20,
      remaining: 19,
      resetAt: new Date('2026-08-12T12:01:00.000Z')
    })
  })

  it('atomically reserves a capped response before invoking the model', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ agentId: agent.id })
    })

    expect(response.status).toBe(200)
    expect(events).toEqual(['reserve', 'model'])
  })

  it('does not invoke the model when the atomic reservation is rejected', async () => {
    reserveAgentResponseSlot.mockResolvedValueOnce(false)

    const response = await POST(request(), {
      params: Promise.resolve({ agentId: agent.id })
    })

    expect(response.status).toBe(403)
    expect(runAgentStream).not.toHaveBeenCalled()
  })

  it('returns 429 before inference when a public-chat rate limit is reached', async () => {
    consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 12,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000)
    })

    const response = await POST(request(), {
      params: Promise.resolve({ agentId: agent.id })
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(runAgentStream).not.toHaveBeenCalled()
    expect(reserveAgentResponseSlot).not.toHaveBeenCalled()
  })
})
