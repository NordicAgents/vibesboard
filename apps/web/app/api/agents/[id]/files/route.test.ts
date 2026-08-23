import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => ({
    ok: true as const,
    user: { id: 'owner-1', email: 'owner@example.test', name: null }
  })
}))
vi.mock('@vibesboard/agents/server', () => ({
  getAgentById: async () => ({
    id: 'agent-1',
    tenantId: 'tenant-1',
    userId: 'owner-1',
    fileKeys: []
  })
}))
vi.mock('@vibesboard/agents/permissions', () => ({
  canEditAgent: async () => true
}))
vi.mock('@vibesboard/adapter-s3', () => ({
  isPermittedAgentFileKey: (
    key: string,
    tenantId: string,
    agentId: string
  ) => key.startsWith(`tenants/${tenantId}/agents/${agentId}/files/`)
}))
vi.mock('@vibesboard/ai/file-processor', () => ({ processFile: vi.fn() }))
vi.mock('@vibesboard/ai/files-store', () => ({
  insertFiles: vi.fn(),
  listFiles: vi.fn()
}))
vi.mock('@vibesboard/ai/tenant-llm-config', () => ({
  resolveProviderSpec: vi.fn()
}))
vi.mock('@vibesboard/ai/provider-routing', () => ({
  shouldResolveTenantProvider: vi.fn()
}))
vi.mock('@vibesboard/agents/versioning', () => ({ recordAgentVersion: vi.fn() }))

const { POST } = await import('./route.ts')

describe('POST /api/agents/[id]/files', () => {
  it('does not attach a same-tenant key belonging to another agent', async () => {
    const response = await POST(
      new Request('http://localhost/api/agents/agent-1/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: [
            {
              fileKey: 'tenants/tenant-1/agents/other-agent/files/private.pdf',
              fileName: 'private.pdf',
              fileSize: 10,
              mimeType: 'application/pdf'
            }
          ]
        })
      }) as never,
      { params: Promise.resolve({ id: 'agent-1' }) }
    )

    expect(response.status).toBe(400)
  })
})
