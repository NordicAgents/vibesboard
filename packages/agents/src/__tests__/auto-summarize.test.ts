import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
  test('writes summary when threshold met', async () => {
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
      assert.equal(row.summary, 'a summary')
      assert.equal(row.summaryResponseCount, 3)
      assert.ok(row.summaryGeneratedAt)
    })
  })

  test('no-op below MIN_RESPONSES_FOR_SUMMARY', async () => {
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
      assert.equal(row.summary, null)
    })
  })
})
