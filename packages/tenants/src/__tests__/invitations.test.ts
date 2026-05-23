import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import { acceptInvitation } from '../invitations.ts'

const HOUR = 60 * 60 * 1000

async function seedTenantAndUser(adminDb: any) {
  const ownerId = uuidv7()
  const inviteeId = uuidv7()
  const tenantId = uuidv7()
  await adminDb.insert(users).values([
    { id: ownerId, email: 'owner@acme.com', name: 'Owner' },
    { id: inviteeId, email: 'guest@acme.com', name: 'Guest' },
  ])
  await adminDb.insert(tenants).values({
    id: tenantId, name: 'Acme', slug: 'acme', createdBy: ownerId, isPersonal: false,
  })
  return { ownerId, inviteeId, tenantId }
}

describe('acceptInvitation', () => {
  test('adds the member with the invited role and marks the invite accepted', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'pending', expiresAt: new Date(Date.now() + HOUR), createdBy: ownerId,
      })

      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })

      assert.deepEqual(result, { ok: true, tenantId })

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, inviteeId), eq(tenantMembers.tenantId, tenantId)))
      assert.equal(ms.length, 1)
      assert.equal(ms[0].role, 'MEMBER')

      const inv = await adminDb.select().from(invitations).where(eq(invitations.token, token))
      assert.equal(inv[0].status, 'accepted')
      assert.notEqual(inv[0].acceptedAt, null)
    })
  })

  test('NOT_FOUND for an unknown token', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { inviteeId } = await seedTenantAndUser(adminDb)
      const result = await acceptInvitation(adminDb, { token: 'nope', userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'NOT_FOUND' })
    })
  })

  test('EXPIRED past the expiry time', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'pending', expiresAt: new Date(Date.now() - HOUR), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'EXPIRED' })
    })
  })

  test('ALREADY_ACCEPTED when the invite was already used', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'accepted', expiresAt: new Date(Date.now() + HOUR),
        acceptedAt: new Date(), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'ALREADY_ACCEPTED' })
    })
  })

  test('ALREADY_MEMBER when the user is already in the tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      await adminDb.insert(tenantMembers).values({ tenantId, userId: inviteeId, role: 'MEMBER' })
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'pending', expiresAt: new Date(Date.now() + HOUR), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'ALREADY_MEMBER' })
    })
  })

  test('INVALID for a non-pending, non-accepted invitation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'expired', expiresAt: new Date(Date.now() + 60 * 60 * 1000), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'INVALID' })
    })
  })
})
