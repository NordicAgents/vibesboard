import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: 'user-1' } })
}))
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => ({
    id: 'agent-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    fileKeys: ['tenants/tenant-1/agents/agent-1/files/file.txt']
  })
}))
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: async () => true
}))

const deleteStorageMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@vibesboard/adapter-s3', () => ({
  deleteFile: (...args: unknown[]) => deleteStorageMock(...args),
  isPermittedAgentFileKey: (
    key: string,
    tenantId: string,
    agentId: string
  ) => key.startsWith(`tenants/${tenantId}/agents/${agentId}/files/`)
}))

const getFilesByKeysMock = vi.fn(async (..._args: unknown[]) => [
  { id: 'file-1', fileKey: 'tenants/tenant-1/agents/agent-1/files/file.txt' }
])
const deleteFilesByKeyMock = vi.fn(async (..._args: unknown[]) => [])
vi.mock('@vibesboard/ai/files-store', () => ({
  getFilesByKeys: (...args: unknown[]) => getFilesByKeysMock(...args),
  deleteFilesByKey: (...args: unknown[]) => deleteFilesByKeyMock(...args)
}))
const deleteFileEmbeddingsMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@vibesboard/ai/rag-store', () => ({
  deleteFileEmbeddings: (...args: unknown[]) =>
    deleteFileEmbeddingsMock(...args)
}))
vi.mock('@vibesboard/agents/versioning', () => ({
  recordAgentVersion: async () => ({ versionNo: 2, created: true })
}))

const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        for: async () => [
          { fileKeys: ['tenants/tenant-1/agents/agent-1/files/file.txt'] }
        ]
      })
    })
  }),
  update: () => ({
    set: () => ({ where: async () => undefined })
  })
}
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => ({
    transaction: async (callback: (value: typeof tx) => unknown) => callback(tx)
  })
}))
vi.mock('@vibesboard/adapter-postgres/schema', () => ({ agents: {} }))

const { POST } = await import('./route.ts')
const fileKey = 'tenants/tenant-1/agents/agent-1/files/file.txt'
const request = () =>
  new Request('http://localhost/api/agents/agent-1/files/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileKey })
  })
const context = { params: Promise.resolve({ id: 'agent-1' }) }

beforeEach(() => {
  deleteStorageMock.mockClear()
  getFilesByKeysMock.mockClear()
  deleteFilesByKeyMock.mockClear()
  deleteFileEmbeddingsMock.mockClear()
})

describe('POST /api/agents/[id]/files/delete', () => {
  it('removes embeddings and the file row in the same transaction', async () => {
    const response = await POST(request() as never, context)
    expect(response.status).toBe(200)
    expect(getFilesByKeysMock).toHaveBeenCalledWith('agent-1', [fileKey], tx)
    expect(deleteFileEmbeddingsMock).toHaveBeenCalledWith(
      'tenant-1',
      'file-1',
      tx
    )
    expect(deleteFilesByKeyMock).toHaveBeenCalledWith('agent-1', fileKey, tx)
    expect(deleteStorageMock).toHaveBeenCalledWith(fileKey)
  })

  it('reports logical deletion as successful when storage cleanup must be retried', async () => {
    deleteStorageMock.mockRejectedValueOnce(new Error('storage unavailable'))

    const response = await POST(request() as never, context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      storageDeleted: false
    })
  })
})
