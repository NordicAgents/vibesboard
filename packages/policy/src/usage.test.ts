import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { agents, tenants, users } from '@vibesboard/adapter-postgres/schema'
import {
  checkLimit,
  checkUsageLimit,
  getUsage,
  getUsageRollup,
  recordUsage
} from './usage.ts'

async function seedAgent(adminDb: any) {
  const userId = randomUUID()
  const tenantId = randomUUID()
  const agentId = randomUUID()
  await adminDb.insert(users).values({
    id: userId,
    email: `usage-${userId}@example.com`,
    name: 'Usage owner'
  })
  await adminDb.insert(tenants).values({
    id: tenantId,
    name: 'Usage tenant',
    slug: `usage-${tenantId.slice(0, 8)}`,
    createdBy: userId,
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: agentId,
    tenantId,
    userId,
    name: 'Usage agent',
    slug: `usage-agent-${agentId.slice(0, 8)}`
  })
  return { tenantId, agentId }
}

afterEach(() => {
  delete process.env.MONTHLY_MESSAGE_LIMIT
})

describe('usage metering (postgres)', () => {
  it('records messages, tokens, sources, and agent totals', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      await recordUsage(
        {
          tenantId,
          agentId,
          conversationId: null,
          userId: null,
          source: 'public_chat',
          model: 'test-model',
          inputTokens: 12,
          outputTokens: 4
        },
        adminDb
      )
      await recordUsage(
        {
          tenantId,
          agentId,
          conversationId: null,
          userId: null,
          source: 'embed',
          model: 'test-model',
          inputTokens: 8,
          outputTokens: 3
        },
        adminDb
      )

      expect(await getUsage({ tenantId, db: adminDb })).toEqual({
        messages: 2,
        limit: Number.POSITIVE_INFINITY
      })
      expect(await getUsageRollup({ tenantId, db: adminDb })).toEqual({
        totalMessages: 2,
        totalInputTokens: 20,
        totalOutputTokens: 7,
        byAgent: { [agentId]: 2 },
        bySource: { public_chat: 1, embed: 1 }
      })
    })
  })

  it('updates a counter atomically under concurrency', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      await Promise.all(
        Array.from({ length: 10 }, () =>
          recordUsage(
            {
              tenantId,
              agentId,
              conversationId: null,
              userId: null,
              source: 'chat',
              model: 'test-model',
              inputTokens: 1,
              outputTokens: 1
            },
            adminDb
          )
        )
      )

      const rollup = await getUsageRollup({ tenantId, db: adminDb })
      expect(rollup.totalMessages).toBe(10)
      expect(rollup.bySource).toEqual({ chat: 10 })
    })
  })

  it('enforces the optional monthly message limit', async () => {
    process.env.MONTHLY_MESSAGE_LIMIT = '1'
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      expect((await checkUsageLimit(tenantId, adminDb)).allowed).toBe(true)

      await recordUsage(
        {
          tenantId,
          agentId,
          conversationId: null,
          userId: null,
          source: 'chat',
          model: 'test-model'
        },
        adminDb
      )

      expect(await checkLimit({ tenantId, db: adminDb })).toEqual({
        allowed: false,
        remaining: 0
      })
    })
  })
})
