import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  reserveAgentResponseSlot,
  incrementAgentResponseCount
} from '../limits.ts'

async function seedAgent(adminDb: any, totalResponseCount = 0) {
  const u = randomUUID(),
    t = randomUUID(),
    a = randomUUID()
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
    name: 'Agent',
    slug: `ag-${a.slice(0, 8)}`,
    totalResponseCount
  })
  return { tenantId: t, agentId: a }
}

describe('agent response limits (postgres)', () => {
  test('incrementAgentResponseCount adds 1 atomically', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 4)
      await incrementAgentResponseCount(tenantId, agentId, adminDb)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(row.totalResponseCount, 5)
    })
  })

  test('reserveAgentResponseSlot returns true below cap and increments', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 9)
      const ok = await reserveAgentResponseSlot(tenantId, agentId, 10, adminDb)
      assert.equal(ok, true)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(row.totalResponseCount, 10)
    })
  })

  test('reserveAgentResponseSlot returns false at cap and does not increment', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 10)
      const ok = await reserveAgentResponseSlot(tenantId, agentId, 10, adminDb)
      assert.equal(ok, false)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(row.totalResponseCount, 10)
    })
  })
})
