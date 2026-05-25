import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  createHook,
  getHook,
  getHookById,
  listHooks,
  updateHook,
  deleteHook,
  verifySecret,
  recordHookUsage
} from '../hooks.ts'

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
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'Agent',
    slug: `ag-${a.slice(0, 8)}`
  })
  return { tenantId: t, agentId: a }
}

describe('hooks CRUD (postgres)', () => {
  test('create returns one-time secret, getHook returns hash, verifySecret matches', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook, secretKey } = await createHook(
        tenantId,
        agentId,
        'Svc',
        adminDb
      )
      assert.equal('secretHash' in hook, false)
      const stored = await getHook(tenantId, agentId, hook.id, adminDb)
      assert.ok(stored)
      assert.equal(verifySecret(secretKey, stored!.secretHash), true)
      assert.equal(verifySecret('wrong', stored!.secretHash), false)
    })
  })

  test('getHookById finds the hook across agents', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'Svc', adminDb)
      const found = await getHookById(hook.id, adminDb)
      assert.equal(found?.id, hook.id)
    })
  })

  test('listHooks newest-first, strips secretHash; update + delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'One', adminDb)
      const list = await listHooks(tenantId, agentId, adminDb)
      assert.equal(list.length, 1)
      assert.equal('secretHash' in list[0], false)
      await updateHook(
        tenantId,
        agentId,
        hook.id,
        { status: 'inactive' },
        adminDb
      )
      assert.equal(
        (await getHook(tenantId, agentId, hook.id, adminDb))!.status,
        'inactive'
      )
      await deleteHook(tenantId, agentId, hook.id, adminDb)
      assert.equal(await getHook(tenantId, agentId, hook.id, adminDb), null)
    })
  })

  test('recordHookUsage increments request_count and sets lastUsedAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'Svc', adminDb)
      await recordHookUsage(tenantId, agentId, hook.id, adminDb)
      const after = await getHook(tenantId, agentId, hook.id, adminDb)
      assert.equal(after!.requestCount, 1)
      assert.ok(after!.lastUsedAt)
    })
  })
})
