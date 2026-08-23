import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({
  auth: async () => ({ user: { id: 'owner-1' } })
}))
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => ({
    id: 'agent-1',
    tenantId: 'tenant-1',
    userId: 'owner-1',
    fileKeys: ['tenants/tenant-1/agents/other-agent/files/private.pdf']
  })
}))
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: async () => true
}))

const getSignedDownloadUrlMock = vi.fn(
  async (..._args: unknown[]) => 'https://storage.example'
)
vi.mock('@vibesboard/adapter-s3', () => ({
  getSignedDownloadUrl: (...args: unknown[]) => getSignedDownloadUrlMock(...args),
  isPermittedAgentFileKey: (
    key: string,
    tenantId: string,
    agentId: string
  ) => key.startsWith(`tenants/${tenantId}/agents/${agentId}/files/`)
}))

const { GET } = await import('./route.ts')

describe('GET /api/agents/[id]/files/download-url', () => {
  it('does not sign a same-tenant file key belonging to another agent', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/agents/agent-1/files/download-url?fileKey=tenants%2Ftenant-1%2Fagents%2Fother-agent%2Ffiles%2Fprivate.pdf'
      ),
      { params: Promise.resolve({ id: 'agent-1' }) }
    )

    expect(response.status).toBe(403)
    expect(getSignedDownloadUrlMock).not.toHaveBeenCalled()
  })
})
