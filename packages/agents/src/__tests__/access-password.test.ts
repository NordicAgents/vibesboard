import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  setAgentAccessPasswordHash,
  clearAgentAccessPasswordHash,
} from '../access-password.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID(),
    t = randomUUID(),
    a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'Agent',
    slug: `ag-${a.slice(0, 8)}`,
  })
  return { tenantId: t, agentId: a }
}

describe('agent access password (postgres)', () => {
  test('set persists the hash, clear nulls it', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      await setAgentAccessPasswordHash(tenantId, agentId, 'hashed-value', adminDb)
      let [row] = await adminDb
        .select({ h: agents.accessPasswordHash })
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(row.h, 'hashed-value')
      await clearAgentAccessPasswordHash(tenantId, agentId, adminDb)
      ;[row] = await adminDb
        .select({ h: agents.accessPasswordHash })
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(row.h, null)
    })
  })

  test('update is scoped by tenant (wrong tenant is a no-op)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seedAgent(adminDb)
      await setAgentAccessPasswordHash(randomUUID(), agentId, 'x', adminDb)
      const [row] = await adminDb
        .select({ h: agents.accessPasswordHash })
        .from(agents)
        .where(eq(agents.id, agentId))
      assert.equal(row.h, null)
    })
  })
})
