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

// Default context window for unknown models is 8_192 tokens.
// Summarization fires at 50% → promptTokens >= 4_096.
const ABOVE_THRESHOLD = 5_000   // 5000/8192 = 61% → triggers
const BELOW_THRESHOLD = 1_000   // 1000/8192 = 12% → no-op
const RESUMMARIZE_DELTA = 2_500 // 25% of 8192 ≈ 2048; use 2500 to clear the bar

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
  it('writes summary when context >= 50% full', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [
            { id: '1', role: 'user', content: 'q1' },
            { id: '2', role: 'assistant', content: 'a1' }
          ],
          tokenUsage: { promptTokens: ABOVE_THRESHOLD }
        },
        { db: adminDb, summarize: async () => 'a summary' }
      )
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe('a summary')
      // summaryResponseCount now stores the prompt token count used as the re-summarize marker
      expect(row.summaryResponseCount).toBe(ABOVE_THRESHOLD)
      expect(row.summaryGeneratedAt).toBeTruthy()
    })
  })

  it('no-op when context below 50%', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'assistant', content: 'a1' }],
          tokenUsage: { promptTokens: BELOW_THRESHOLD }
        },
        { db: adminDb, summarize: async () => 'unused' }
      )
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe(null)
    })
  })

  it('no-op when no tokenUsage provided', async () => {
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
          // no tokenUsage → usageRatio = 0 → no-op
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
          ],
          tokenUsage: { promptTokens: ABOVE_THRESHOLD }
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

  it('skips re-summarizing until token count grows by 25% since last summary', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      let called = 0
      // currentSummary was written at promptTokens=5000; new total is 5500.
      // delta (5500-5000=500) < contextWindow*0.25 (~2048) → no re-summarize.
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'assistant', content: 'a1' }],
          currentSummary: 'old summary',
          summaryResponseCount: ABOVE_THRESHOLD,    // token marker from last summary
          tokenUsage: { promptTokens: ABOVE_THRESHOLD + 500 }  // only 500 tokens more
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

  it('re-summarizes when token count grows by > 25% since last summary', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      let called = 0
      // Previous summary at 5000 tokens; now at 5000 + RESUMMARIZE_DELTA → triggers.
      await maybeAutoSummarize(
        {
          tenantId,
          agentId,
          conversationId,
          messages: [{ id: '1', role: 'assistant', content: 'a1' }],
          currentSummary: 'old summary',
          summaryResponseCount: ABOVE_THRESHOLD,
          tokenUsage: { promptTokens: ABOVE_THRESHOLD + RESUMMARIZE_DELTA }
        },
        {
          db: adminDb,
          summarize: async () => {
            called += 1
            return 'new summary'
          }
        }
      )
      expect(called).toBe(1)
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe('new summary')
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
          ],
          tokenUsage: { promptTokens: ABOVE_THRESHOLD }
        },
        { db: adminDb, summarize: async () => null }
      )
      const [row] = await adminDb.select().from(conversations)
      expect(row.summary).toBe(null)
    })
  })
})
