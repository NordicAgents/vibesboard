import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { createInviteCode, listInviteCodes, revokeInviteCode, redeemInviteCode } from '../invite-codes.ts'

async function seed(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0, 8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0, 8)}`, instructions: 'instructions ok' })
  return { tenantId: t, agentId: a }
}

describe('invite codes', () => {
  it('create + list', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const c = await createInviteCode(tenantId, agentId, { maxUses: 2 }, adminDb)
      expect(c.usedCount).toBe(0); expect(c.maxUses).toBe(2); expect(c.code).toBe(c.code.toUpperCase())
      const list = await listInviteCodes(tenantId, agentId, adminDb)
      expect(list.length).toBe(1)
    })
  })
  it('redeem increments + records; respects maxUses', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const c = await createInviteCode(tenantId, agentId, { code: 'abc123', maxUses: 1 }, adminDb)
      expect(await redeemInviteCode(tenantId, agentId, 'ABC123', 'ext1', adminDb)).toEqual({ ok: true })
      const after = (await listInviteCodes(tenantId, agentId, adminDb))[0]
      expect(after.usedCount).toBe(1); expect(after.redemptions.length).toBe(1)
      expect(await redeemInviteCode(tenantId, agentId, 'ABC123', 'ext2', adminDb)).toEqual({ ok: false, reason: 'max_uses_reached' })
    })
  })
  it('invalid / revoked / expired', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      expect(await redeemInviteCode(tenantId, agentId, 'NOPE', 'e', adminDb)).toEqual({ ok: false, reason: 'invalid' })
      const r = await createInviteCode(tenantId, agentId, { code: 'rev1' }, adminDb)
      await revokeInviteCode(tenantId, agentId, r.id, adminDb)
      expect(await redeemInviteCode(tenantId, agentId, 'REV1', 'e', adminDb)).toEqual({ ok: false, reason: 'revoked' })
      const e = await createInviteCode(tenantId, agentId, { code: 'exp1', expiresAt: new Date(Date.now()-1000).toISOString() }, adminDb)
      expect(await redeemInviteCode(tenantId, agentId, 'EXP1', 'e', adminDb)).toEqual({ ok: false, reason: 'expired' })
    })
  })

  it('redeem normalizes lowercase input to uppercase before matching', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      await createInviteCode(tenantId, agentId, { code: 'mixed1' }, adminDb)
      expect(await redeemInviteCode(tenantId, agentId, 'mixed1', 'e', adminDb)).toEqual({ ok: true })
    })
  })

  it('unlimited (null maxUses) code can be redeemed repeatedly', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const c = await createInviteCode(tenantId, agentId, { code: 'open1' }, adminDb)
      expect(c.maxUses).toBe(null)
      expect(await redeemInviteCode(tenantId, agentId, 'OPEN1', 'e1', adminDb)).toEqual({ ok: true })
      expect(await redeemInviteCode(tenantId, agentId, 'OPEN1', 'e2', adminDb)).toEqual({ ok: true })
      const after = (await listInviteCodes(tenantId, agentId, adminDb))[0]
      expect(after.usedCount).toBe(2)
      // redemptions store { redeemedAt, externalId }
      expect(after.redemptions.map((r: any) => r.externalId)).toEqual(['e1', 'e2'])
    })
  })

  it('listInviteCodes returns newest first', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      await createInviteCode(tenantId, agentId, { code: 'first1' }, adminDb)
      const second = await createInviteCode(tenantId, agentId, { code: 'second2' }, adminDb)
      const list = await listInviteCodes(tenantId, agentId, adminDb)
      expect(list[0].id).toBe(second.id)
    })
  })

  it('codes are isolated per tenant/agent (cross-tenant cannot redeem)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seed(adminDb)
      await createInviteCode(a.tenantId, a.agentId, { code: 'tenanta1' }, adminDb)
      // tenant B's scope cannot see or redeem tenant A's code
      expect(await redeemInviteCode(b.tenantId, b.agentId, 'TENANTA1', 'e', adminDb)).toEqual({ ok: false, reason: 'invalid' })
      expect(await listInviteCodes(b.tenantId, b.agentId, adminDb)).toEqual([])
    })
  })
})
