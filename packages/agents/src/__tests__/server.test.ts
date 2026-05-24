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
})
