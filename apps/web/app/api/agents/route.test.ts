import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => ({
    ok: true as const,
    user: { id: 'user-1', email: 'owner@example.com', name: null }
  })
}))
vi.mock('@vibesboard/policy/permissions', () => ({
  isMemberOfTenant: async () => true,
  isSuperAdmin: async () => false
}))
vi.mock('@/lib/tenant-context', () => ({
  getActiveTenant: async () => 'tenant-1',
  getTenantById: async () => null
}))
vi.mock('@vibesboard/agents/file-processing', () => ({
  createAgentFilesAndTriggerProcessing: async () => undefined
}))
vi.mock('@vibesboard/agents/versioning', () => ({
  recordAgentVersion: async () => ({ versionNo: 1, created: true })
}))

const agentRow = {
  id: 'agent-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  name: 'Support',
  instructions: 'Help customers',
  fileKeys: [],
  sourceUrls: ['https://theunseenhook.com'],
  tools: [],
  allowAnonymous: false,
  accessPasswordHash: 'must-not-leak',
  slug: 'support',
  greetingText: 'Hello',
  mode: 'provider',
  collectionFields: null,
  maxResponses: null,
  maxAgentResponses: null,
  totalResponseCount: 0,
  quickSuggestionsMode: 'off',
  quickSuggestionsCount: 4,
  handoffTargets: [],
  googleReviewEnabled: false,
  googlePlaceId: null,
  retrievalStrategy: 'direct',
  notificationConfig: {
    enabled: true,
    webhook: {
      enabled: true,
      url: 'https://hooks.example.test/notify',
      secret: 'live-hmac-signing-secret'
    }
  },
  schedulingConfig: null,
  dataConfig: null,
  calendarAvailabilityConfig: null,
  bookingConfig: null,
  lastEmbeddingsSyncAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z')
}

let selectCall = 0
const dbMock = {
  select: vi.fn(() => {
    selectCall += 1
    if (selectCall === 1) {
      return {
        from: () => ({ where: async () => [{ count: 1 }] })
      }
    }
    return {
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              offset: () => ({
                limit: async () => [{ agent: agentRow, tenantSlug: 'acme' }]
              })
            })
          })
        })
      })
    }
  })
}
vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => dbMock
}))

const { GET } = await import('./route.ts')

beforeEach(() => {
  selectCall = 0
  dbMock.select.mockClear()
})

describe('GET /api/agents', () => {
  it('returns password presence without returning an access-password hash', async () => {
    const response = await GET(new Request('http://localhost/api/agents'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.agents[0].hasAccessPassword).toBe(true)
    expect(body.agents[0].sourceUrls).toEqual(['https://theunseenhook.com'])
    expect(body.agents[0]).not.toHaveProperty('accessPassword')
    expect(body.agents[0]).not.toHaveProperty('accessPasswordHash')
    expect(body.agents[0].notificationConfig.webhook).not.toHaveProperty(
      'secret'
    )
  })
})
