import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  conversations
} from '@vibesboard/adapter-postgres/schema'
import { maybeAutoSummarize } from '../auto-summarize.ts'

async function seedConv(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  const a = randomUUID()
  const c = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'A',
    slug: `a-${a.slice(0, 8)}`,
    instructions: 'ok ok ok'
  })
  await adminDb.insert(conversations).values({ id: c, tenantId: t, agentId: a })
  return { tenantId: t, agentId: a, conversationId: c, adminDb }
}

describe('maybeAutoSummarize (pg)', () => {
  it('writes summary when threshold met', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'q1' },
            { id: '2', role: 'assistant', content: 'a1' },
            { id: '3', role: 'assistant', content: 'a2' },
            { id: '4', role: 'assistant', content: 'a3' }
          ]
        },
        { db: adminDb, summarize: async () => 'a summary' }
      )
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe('a summary')
      expect(row.summaryResponseCount).toBe(3)
      expect(row.summaryGeneratedAt).toBeTruthy()
    })
  })

  it('no-op below MIN_RESPONSES_FOR_SUMMARY', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'assistant', content: 'a1' }]
        },
        { db: adminDb, summarize: async () => 'unused' }
      )
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe(null)
    })
  })

  it('does not call summarize when below the threshold', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      let called = 0
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'q' },
            { id: '2', role: 'assistant', content: 'a1' }
          ]
        },
        {
          db: adminDb,
          summarize: async () => {
            called += 1
            return 'x'
          }
        }
      )
      expect(called).toBe(0)
    })
  })

  it('passes the conversation messages through to the summarizer', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      let received: { id: string; role: string; content: string }[] = []
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'assistant', content: 'a1' },
            { id: '2', role: 'assistant', content: 'a2' },
            { id: '3', role: 'assistant', content: 'a3' }
          ]
        },
        {
          db: adminDb,
          summarize: async (msgs) => {
            received = msgs as typeof received
            return 'done'
          }
        }
      )
      expect(received.map((m) => m.content)).toEqual(['a1', 'a2', 'a3'])
    })
  })

  it('counts responses from responseCounts (+1) instead of message roles', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      let called = 0
      // Only one assistant message, but responseCounts already sums to 2,
      // so totalResponses = 2 + 1 = 3 → at the MIN threshold → summarizes.
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'assistant', content: 'a1' }],
          responseCounts: { [agentId]: 2 }
        },
        {
          db: adminDb,
          summarize: async () => {
            called += 1
            return 'sum'
          }
        }
      )
      expect(called).toBe(1)
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe('sum')
      expect(row.summaryResponseCount).toBe(3)
    })
  })

  it('skips re-summarizing until RE_SUMMARIZE_DELTA new responses accrue', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      let called = 0
      // currentSummary present at summaryResponseCount=3; new total = 3+1 = 4.
      // delta (4-3=1) < RE_SUMMARIZE_DELTA(5) → no re-summarize.
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'assistant', content: 'a1' }],
          responseCounts: { [agentId]: 3 },
          currentSummary: 'old summary',
          summaryResponseCount: 3
        },
        {
          db: adminDb,
          summarize: async () => {
            called += 1
            return 'new'
          }
        }
      )
      expect(called).toBe(0)
    })
  })

  it('does not write when the summarizer returns null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'assistant', content: 'a1' },
            { id: '2', role: 'assistant', content: 'a2' },
            { id: '3', role: 'assistant', content: 'a3' }
          ]
        },
        { db: adminDb, summarize: async () => null }
      )
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe(null)
    })
  })
})
