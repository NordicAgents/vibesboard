import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: 'user-1' } })
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

const getSignedUploadUrlMock = vi.fn(
  async (..._args: unknown[]) => 'https://storage.example/upload'
)
vi.mock('@vibesboard/adapter-s3', () => ({
  agentFileKey: (tenantId: string, agentId: string, fileName: string) =>
    `tenants/${tenantId}/agents/${agentId}/files/${fileName}`,
  getSignedUploadUrl: (...args: unknown[]) => getSignedUploadUrlMock(...args)
}))

const { POST } = await import('./route.ts')
const context = { params: Promise.resolve({ id: 'agent-1' }) }

const request = (body: unknown) =>
  new Request('http://localhost/api/agents/agent-1/files/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

beforeEach(() => getSignedUploadUrlMock.mockClear())

describe('POST /api/agents/[id]/files/upload-url', () => {
  it('mints the canonical agent key and signs the exact upload length', async () => {
    const response = await POST(
      request({ fileName: 'notes.txt', contentType: 'text/plain', fileSize: 42 }) as never,
      context
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      fileKey: 'tenants/tenant-1/agents/agent-1/files/notes.txt'
    })
    expect(getSignedUploadUrlMock).toHaveBeenCalledWith(
      'tenants/tenant-1/agents/agent-1/files/notes.txt',
      'text/plain',
      undefined,
      42
    )
  })

  it('rejects files over 10 MB before signing a URL', async () => {
    const response = await POST(
      request({
        fileName: 'large.pdf',
        contentType: 'application/pdf',
        fileSize: 10 * 1024 * 1024 + 1
      }) as never,
      context
    )

    expect(response.status).toBe(413)
    expect(getSignedUploadUrlMock).not.toHaveBeenCalled()
  })
})
