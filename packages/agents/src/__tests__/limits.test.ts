import { describe, it, expect } from 'vitest'
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
  it('incrementAgentResponseCount adds 1 atomically', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 4)
      await incrementAgentResponseCount(tenantId, agentId, adminDb)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(row.totalResponseCount).toBe(5)
    })
  })

  it('reserveAgentResponseSlot returns true below cap and increments', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 9)
      const ok = await reserveAgentResponseSlot(tenantId, agentId, 10, adminDb)
      expect(ok).toBe(true)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(row.totalResponseCount).toBe(10)
    })
  })

  it('reserveAgentResponseSlot returns false at cap and does not increment', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 10)
      const ok = await reserveAgentResponseSlot(tenantId, agentId, 10, adminDb)
      expect(ok).toBe(false)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(row.totalResponseCount).toBe(10)
    })
  })

  it('reserveAgentResponseSlot is a no-op for an unknown agent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedAgent(adminDb, 0)
      const ok = await reserveAgentResponseSlot(tenantId, randomUUID(), 10, adminDb)
      expect(ok).toBe(false)
    })
  })

  it('reserveAgentResponseSlot is scoped per tenant (wrong tenant cannot consume the slot)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seedAgent(adminDb, 0)
      const ok = await reserveAgentResponseSlot(randomUUID(), agentId, 10, adminDb)
      expect(ok).toBe(false)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(row.totalResponseCount).toBe(0)
    })
  })

  it('reserveAgentResponseSlot can be called concurrently without exceeding the cap', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 0)
      const cap = 3
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          reserveAgentResponseSlot(tenantId, agentId, cap, adminDb)
        )
      )
      const granted = results.filter((r) => r === true).length
      expect(granted).toBe(cap)
      const [row] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(row.totalResponseCount).toBe(cap)
    })
  })
})
