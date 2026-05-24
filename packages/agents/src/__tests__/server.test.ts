import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  getAgentForMember,
  getAgentForUser,
  getAgentById,
  getAgentBySlug,
  getAgentNamesByTenant,
  getAgentsForTenant,
} from '../server.ts'

async function seed(adminDb: any) {
  const userId = randomUUID()
  const tenantId = randomUUID()
  const agentId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: 'o@a.com', name: 'O' })
  await adminDb.insert(tenants).values({
    id: tenantId,
    name: 'Acme',
    slug: 'acme',
    createdBy: userId,
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: agentId,
    tenantId,
    userId,
    name: 'Support',
    slug: 'support',
    instructions: 'hi',
  })
  return { userId, tenantId, agentId }
}

describe('agent server reads', () => {
  test('getAgentForMember maps row + tenantSlug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const a = await getAgentForMember(tenantId, agentId, adminDb)
      assert.equal(a?.id, agentId)
      assert.equal(a?.agentUrl, 'support')
      assert.equal(a?.tenantSlug, 'acme')
    })
  })

  test('getAgentById finds across tenants', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seed(adminDb)
      assert.equal((await getAgentById(agentId, adminDb))?.id, agentId)
      assert.equal(await getAgentById(randomUUID(), adminDb), null)
    })
  })

  test('getAgentBySlug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seed(adminDb)
      assert.equal((await getAgentBySlug(tenantId, 'support', adminDb))?.name, 'Support')
      assert.equal(await getAgentBySlug(tenantId, 'nope', adminDb), null)
    })
  })

  test('getAgentForUser respects ownership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seed(adminDb)
      assert.equal((await getAgentForUser(tenantId, agentId, userId, adminDb))?.id, agentId)
      assert.equal(await getAgentForUser(tenantId, agentId, randomUUID(), adminDb), null)
    })
  })

  test('getAgentNamesByTenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      assert.deepEqual(await getAgentNamesByTenant(tenantId, [agentId], adminDb), {
        [agentId]: 'Support',
      })
      assert.deepEqual(await getAgentNamesByTenant(tenantId, [], adminDb), {})
    })
  })

  test('getAgentsForTenant lists agents for the tenant, newest first, mapped', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seed(adminDb)
      // a second, newer agent in the same tenant
      const newerId = randomUUID()
      await adminDb.insert(agents).values({
        id: newerId,
        tenantId,
        userId,
        name: 'Sales',
        slug: 'sales',
        instructions: 'hi',
        createdAt: new Date(Date.now() + 1000),
      })
      // an agent in a different tenant — must NOT appear
      const otherTenant = randomUUID()
      await adminDb.insert(tenants).values({
        id: otherTenant,
        name: 'Other',
        slug: 'other',
        createdBy: userId,
        isPersonal: false,
      })
      await adminDb.insert(agents).values({
        id: randomUUID(),
        tenantId: otherTenant,
        userId,
        name: 'Nope',
        slug: 'nope',
        instructions: 'hi',
      })

      const list = await getAgentsForTenant(tenantId, adminDb)
      assert.equal(list.length, 2)
      assert.deepEqual(
        list.map((a) => a.id),
        [newerId, agentId],
      ) // newest first
      assert.equal(list[0].tenantSlug, 'acme')
      assert.equal(list[1].agentUrl, 'support')
    })
  })

  test('getAgentsForTenant returns [] for a tenant with no agents', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { userId } = await seed(adminDb)
      const empty = randomUUID()
      await adminDb.insert(tenants).values({
        id: empty,
        name: 'Empty',
        slug: 'empty',
        createdBy: userId,
        isPersonal: false,
      })
      assert.deepEqual(await getAgentsForTenant(empty, adminDb), [])
    })
  })
})
