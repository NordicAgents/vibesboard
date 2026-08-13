import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => ({
    ok: true,
    user: { id: 'user-1', email: 'owner@example.com', name: null }
  })
}))
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => ({
    id: 'agent-1',
    tenantId: 'tenant-1',
    userId: 'user-1'
  })
}))
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: async () => true
}))

const indexedFile = {
  id: 'file-1',
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  fileKey: 'user-1/file.txt',
  fileName: 'file.txt',
  mimeType: 'text/plain',
  status: 'indexed'
}
const dbMock = {
  select: () => ({
    from: () => ({
      where: async () => [indexedFile]
    })
  })
}
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => dbMock
}))
vi.mock('@vibesboard/adapter-postgres/schema', () => ({ files: {} }))

const ingestFileForAgentMock = vi.fn()
vi.mock('@vibesboard/ai/file-search', () => ({
  ingestFileForAgent: (...args: unknown[]) => ingestFileForAgentMock(...args)
}))

const { POST } = await import('./route.ts')
const request = new Request('http://localhost/api/agents/agent-1/reembed', {
  method: 'POST'
})
const context = { params: Promise.resolve({ id: 'agent-1' }) }

beforeEach(() => {
  ingestFileForAgentMock.mockReset()
})

describe('POST /api/agents/[id]/reembed', () => {
  it('counts a zero-chunk result as a failure', async () => {
    ingestFileForAgentMock.mockResolvedValue({
      chunksInserted: 0,
      message: 'No embeddings generated for file.'
    })

    const response = await POST(request as never, context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reembedded: 0,
      total: 1,
      errors: ['file.txt: No embeddings generated for file.']
    })
  })

  it('counts a positive chunk result as success', async () => {
    ingestFileForAgentMock.mockResolvedValue({ chunksInserted: 3 })

    const response = await POST(request as never, context)
    await expect(response.json()).resolves.toMatchObject({
      reembedded: 1,
      total: 1,
      errors: []
    })
  })
})
