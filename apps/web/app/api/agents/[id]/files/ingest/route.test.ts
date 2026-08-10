import { beforeEach, describe, expect, it, vi } from 'vitest'

const authState = {
  ok: true as const,
  user: { id: 'user-1', email: 'owner@example.com', name: null }
}
vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => authState
}))

const agent = {
  id: 'agent-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  fileKeys: ['user-1/file.txt']
}
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => agent
}))
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: async () => true
}))

const fileRecord = {
  id: 'file-1',
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  userId: 'user-1',
  fileKey: 'user-1/file.txt',
  fileName: 'file.txt',
  mimeType: 'text/plain',
  fileSize: 10,
  status: 'pending',
  processingError: null,
  embeddingProvider: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}
const setFileStatusMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@vibesboard/ai/files-store', () => ({
  getFileByKey: async () => fileRecord,
  insertFiles: async () => [fileRecord],
  setFileStatus: (...args: unknown[]) => setFileStatusMock(...args)
}))

const ingestFileForAgentMock = vi.fn()
vi.mock('@vibesboard/ai/file-search', () => ({
  ingestFileForAgent: (...args: unknown[]) => ingestFileForAgentMock(...args)
}))

const { POST } = await import('./route.ts')

const request = () =>
  new Request('http://localhost/api/agents/agent-1/files/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileKey: 'user-1/file.txt' })
  })
const context = { params: Promise.resolve({ id: 'agent-1' }) }

beforeEach(() => {
  ingestFileForAgentMock.mockReset()
  setFileStatusMock.mockClear()
})

describe('POST /api/agents/[id]/files/ingest', () => {
  it('returns a failure response when ingestion creates no chunks', async () => {
    ingestFileForAgentMock.mockResolvedValue({
      chunksInserted: 0,
      message: 'Embedding API quota exceeded'
    })

    const response = await POST(request() as never, context)
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Embedding API quota exceeded',
      chunksInserted: 0
    })
    expect(setFileStatusMock).toHaveBeenCalledWith('file-1', 'failed', {
      error: 'Embedding API quota exceeded'
    })
  })

  it('returns success only when searchable chunks were inserted', async () => {
    ingestFileForAgentMock.mockResolvedValue({
      chunksInserted: 2,
      totalChars: 120,
      message: 'Ingested 2 chunks'
    })

    const response = await POST(request() as never, context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      chunksInserted: 2
    })
  })
})
