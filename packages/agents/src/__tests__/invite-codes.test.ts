import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { createInviteCode, listInviteCodes, revokeInviteCode, redeemInviteCode } from '../invite-codes.ts'

async function seed(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: 'o@a.com', name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: 'acme', createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: 'a', instructions: 'instructions ok' })
  return { tenantId: t, agentId: a }
}

describe('invite codes', () => {
  test('create + list', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const c = await createInviteCode(tenantId, agentId, { maxUses: 2 }, adminDb)
      assert.equal(c.usedCount, 0); assert.equal(c.maxUses, 2); assert.equal(c.code, c.code.toUpperCase())
      const list = await listInviteCodes(tenantId, agentId, adminDb)
      assert.equal(list.length, 1)
    })
  })
  test('redeem increments + records; respects maxUses', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const c = await createInviteCode(tenantId, agentId, { code: 'abc123', maxUses: 1 }, adminDb)
      assert.deepEqual(await redeemInviteCode(tenantId, agentId, 'ABC123', 'ext1', adminDb), { ok: true })
      const after = (await listInviteCodes(tenantId, agentId, adminDb))[0]
      assert.equal(after.usedCount, 1); assert.equal(after.redemptions.length, 1)
      assert.deepEqual(await redeemInviteCode(tenantId, agentId, 'ABC123', 'ext2', adminDb), { ok: false, reason: 'max_uses_reached' })
    })
  })
  test('invalid / revoked / expired', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      assert.deepEqual(await redeemInviteCode(tenantId, agentId, 'NOPE', 'e', adminDb), { ok: false, reason: 'invalid' })
      const r = await createInviteCode(tenantId, agentId, { code: 'rev1' }, adminDb)
      await revokeInviteCode(tenantId, agentId, r.id, adminDb)
      assert.deepEqual(await redeemInviteCode(tenantId, agentId, 'REV1', 'e', adminDb), { ok: false, reason: 'revoked' })
      const e = await createInviteCode(tenantId, agentId, { code: 'exp1', expiresAt: new Date(Date.now()-1000).toISOString() }, adminDb)
      assert.deepEqual(await redeemInviteCode(tenantId, agentId, 'EXP1', 'e', adminDb), { ok: false, reason: 'expired' })
    })
  })
})
