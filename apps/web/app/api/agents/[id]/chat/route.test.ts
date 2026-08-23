import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const agent = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  name: 'Other workspace agent',
  handoffTargets: [],
  maxAgentResponses: null,
  maxResponses: null
}

const canEditAgent = vi.fn(async () => false)
const runAgentStream = vi.fn()

vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => ({
    ok: true as const,
    user: { id: '00000000-0000-4000-8000-000000000004' }
  })
}))
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => agent,
  getAgentNamesByTenant: async () => ({})
}))
vi.mock('@vibesboard/agents/permissions', () => ({ canEditAgent }))
vi.mock('@vibesboard/agents/schema', () => ({
  agentChatRequestSchema: { parse: (value: unknown) => value }
}))
vi.mock('@vibesboard/agents/conversations', () => ({
  ensureConversation: vi.fn(),
  updateConversationMessages: vi.fn(),
  getConversation: vi.fn(),
  recordConversationHandoff: vi.fn()
}))
vi.mock('@vibesboard/agents/auto-summarize', () => ({
  maybeAutoSummarize: vi.fn()
}))
vi.mock('@vibesboard/ai/runtime', () => ({ runAgentStream }))
vi.mock('@vibesboard/utils', () => ({ nanoid: () => 'message-id' }))
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
vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn(),
  recordUsage: vi.fn(),
  usageLimitResponse: vi.fn()
}))
vi.mock('@vibesboard/agents/limits', () => ({
  incrementAgentResponseCount: vi.fn(),
  reserveAgentResponseSlot: vi.fn()
}))
vi.mock('@vibesboard/adapter-openai', () => ({ OPENAI_CHAT_MODEL: 'test' }))

const { POST } = await import('./route.ts')

describe('POST /api/agents/[id]/chat', () => {
  it('rejects an authenticated user who cannot access the agent tenant', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/agents/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [] })
      }),
      { params: Promise.resolve({ id: agent.id }) }
    )

    expect(response.status).toBe(403)
    expect(canEditAgent).toHaveBeenCalledWith({
      sessionUserId: '00000000-0000-4000-8000-000000000004',
      agentOwnerId: agent.userId,
      tenantId: agent.tenantId
    })
    expect(runAgentStream).not.toHaveBeenCalled()
  })
})
