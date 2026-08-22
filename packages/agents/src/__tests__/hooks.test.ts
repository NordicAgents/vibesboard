import { describe, it, expect } from 'vitest'
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
  it('create returns one-time secret, getHook returns hash, verifySecret matches', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook, secretKey } = await createHook(
        tenantId,
        agentId,
        'Svc',
        adminDb
      )
      expect('secretHash' in hook).toBe(false)
      const stored = await getHook(tenantId, agentId, hook.id, adminDb)
      expect(stored).toBeTruthy()
      expect(verifySecret(secretKey, stored!.secretHash)).toBe(true)
      expect(verifySecret('wrong', stored!.secretHash)).toBe(false)
    })
  })

  it('getHookById finds the hook across agents', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'Svc', adminDb)
      const found = await getHookById(hook.id, adminDb)
      expect(found?.id).toBe(hook.id)
    })
  })

  it('getHookById returns null for an unknown id', async () => {
    await withTestDb(async ({ adminDb }) => {
      expect(await getHookById(randomUUID(), adminDb)).toBe(null)
    })
  })

  it('listHooks newest-first, strips secretHash; update + delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'One', adminDb)
      const list = await listHooks(tenantId, agentId, adminDb)
      expect(list.length).toBe(1)
      expect('secretHash' in list[0]).toBe(false)
      await updateHook(
        tenantId,
        agentId,
        hook.id,
        { status: 'inactive' },
        adminDb
      )
      expect(
        (await getHook(tenantId, agentId, hook.id, adminDb))!.status
      ).toBe('inactive')
      await deleteHook(tenantId, agentId, hook.id, adminDb)
      expect(await getHook(tenantId, agentId, hook.id, adminDb)).toBe(null)
    })
  })

  it('recordHookUsage increments request_count and sets lastUsedAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'Svc', adminDb)
      await recordHookUsage(tenantId, agentId, hook.id, adminDb)
      const after = await getHook(tenantId, agentId, hook.id, adminDb)
      expect(after!.requestCount).toBe(1)
      expect(after!.lastUsedAt).toBeTruthy()
    })
  })

  it('verifySecret rejects a malformed (non-hex / wrong-length) hash', () => {
    expect(verifySecret('anything', 'not-a-valid-hex-hash')).toBe(false)
  })

  it('getHook is scoped by tenant and agent (cross-tenant isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedAgent(adminDb)
      const b = await seedAgent(adminDb)
      const { hook } = await createHook(a.tenantId, a.agentId, 'Svc', adminDb)
      // tenant B cannot read tenant A's hook through the scoped read
      expect(await getHook(b.tenantId, b.agentId, hook.id, adminDb)).toBe(null)
      // correct tenant but wrong agent also fails
      expect(await getHook(a.tenantId, b.agentId, hook.id, adminDb)).toBe(null)
    })
  })

  it('update / delete from another tenant are no-ops', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedAgent(adminDb)
      const b = await seedAgent(adminDb)
      const { hook } = await createHook(a.tenantId, a.agentId, 'Svc', adminDb)
      await updateHook(
        b.tenantId,
        b.agentId,
        hook.id,
        { status: 'inactive' },
        adminDb
      )
      await deleteHook(b.tenantId, b.agentId, hook.id, adminDb)
      const stillThere = await getHook(a.tenantId, a.agentId, hook.id, adminDb)
      expect(stillThere?.status).toBe('active')
    })
  })
})
