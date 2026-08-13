import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const events: string[] = []
const consumeRateLimit = vi.fn()
const reserveAgentResponseSlot = vi.fn()
const completeText = vi.fn(async () => {
  events.push('model')
  return {
    text: 'A useful review.',
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 4 }
  }
})

const agent = {
  id: '00000000-0000-4000-8000-000000000011',
  tenantId: '00000000-0000-4000-8000-000000000012',
  allowAnonymous: true,
  maxAgentResponses: 10,
  totalResponseCount: 9
}

vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: vi.fn(async () => agent)
}))
vi.mock('@vibesboard/adapter-openai', () => ({
  completeText,
  OPENAI_CHAT_MODEL: 'test-model'
}))
vi.mock('@/lib/agent-cookies', () => ({
  ensureExternalSessionId: vi.fn(async () => 'external-session')
}))
vi.mock('@vibesboard/policy/rate-limit', () => ({
  consumeRateLimit,
  getRateLimitSalt: () => 'test-rate-limit-salt-that-is-long-enough',
  getTrustedClientAddress: () => '203.0.113.10'
}))
vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true })),
  recordUsage: vi.fn(async () => undefined),
  usageLimitResponse: vi.fn()
}))
vi.mock('@vibesboard/agents/limits', () => ({
  reserveAgentResponseSlot,
  incrementAgentResponseCount: vi.fn(async () => undefined)
}))

const { POST } = await import('./route.ts')

function request() {
  return new NextRequest('http://localhost/api/public/agents/agent/review', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'The service was excellent.' }]
    })
  })
}

describe('public review generation protections', () => {
  beforeEach(() => {
    events.length = 0
    completeText.mockClear()
    consumeRateLimit.mockReset()
    consumeRateLimit.mockResolvedValue({
      allowed: true,
      limit: 6,
      remaining: 5,
      resetAt: new Date(Date.now() + 60_000)
    })
    reserveAgentResponseSlot.mockReset()
    reserveAgentResponseSlot.mockImplementation(async () => {
      events.push('reserve')
      return true
    })
  })

  it('reserves a capped agent response before invoking the model', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ agentId: agent.id })
    })

    expect(response.status).toBe(200)
    expect(events).toEqual(['reserve', 'model'])
  })

  it('returns 429 before inference when rate limited', async () => {
    consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 6,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000)
    })

    const response = await POST(request(), {
      params: Promise.resolve({ agentId: agent.id })
    })

    expect(response.status).toBe(429)
    expect(completeText).not.toHaveBeenCalled()
    expect(reserveAgentResponseSlot).not.toHaveBeenCalled()
  })

  it('returns 403 before inference when the lifetime cap is exhausted', async () => {
    reserveAgentResponseSlot.mockResolvedValueOnce(false)

    const response = await POST(request(), {
      params: Promise.resolve({ agentId: agent.id })
    })

    expect(response.status).toBe(403)
    expect(completeText).not.toHaveBeenCalled()
  })
})
