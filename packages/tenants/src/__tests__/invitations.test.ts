import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import { acceptInvitation, createInvitation, listInvitations, getInvitationByToken, getInvitationTenant, cancelInvitation } from '../invitations.ts'

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

describe('createInvitation / listInvitations', () => {
  test('creates a pending invitation and lists it', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, {
        tenantId, email: 'New@Acme.com', role: 'MEMBER', token: 'tok-1', createdBy: ownerId,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600000),
      })
      assert.equal(r.ok, true)
      if (!r.ok) return
      assert.equal(r.invitation.email, 'new@acme.com')
      const list = await listInvitations(adminDb, tenantId)
      assert.equal(list.length, 1)
      assert.equal(list[0].status, 'pending')
    })
  })
  test('ALREADY_MEMBER when email is an existing member', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await adminDb.insert(tenantMembers).values({ tenantId, userId: ownerId, role: 'TENANT_ADMIN' })
      const r = await createInvitation(adminDb, {
        tenantId, email: 'owner@acme.com', role: 'MEMBER', token: 'tok-2', createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      assert.deepEqual(r, { ok: false, code: 'ALREADY_MEMBER' })
    })
  })
  test('PENDING_EXISTS on duplicate pending invite', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, { tenantId, email: 'dup@x.com', role: 'MEMBER', token: 't1', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      const r = await createInvitation(adminDb, { tenantId, email: 'dup@x.com', role: 'MEMBER', token: 't2', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      assert.deepEqual(r, { ok: false, code: 'PENDING_EXISTS' })
    })
  })
})

describe('getInvitationByToken / cancelInvitation', () => {
  test('preview returns tenant + inviter; reconciles expiry', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, { tenantId, email: 'p@x.com', role: 'MEMBER', token: 'prev-tok', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      const preview = await getInvitationByToken(adminDb, 'prev-tok')
      assert.equal(preview?.tenant_name, 'Acme')
      assert.equal(preview?.invited_by_email, 'owner@acme.com')
      assert.equal(preview?.status, 'pending')
      assert.equal(await getInvitationByToken(adminDb, 'missing'), null)
    })
  })
  test('past-expiry pending preview flips to expired', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, { tenantId, email: 'e@x.com', role: 'MEMBER', token: 'exp-tok', createdBy: ownerId, expiresAt: new Date(Date.now() - 3600000) })
      const preview = await getInvitationByToken(adminDb, 'exp-tok')
      assert.equal(preview?.status, 'expired')
    })
  })
  test('cancelInvitation expires a pending invite; NOT_FOUND when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, { tenantId, email: 'c@x.com', role: 'MEMBER', token: 'c-tok', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      if (!r.ok) return
      assert.deepEqual(await cancelInvitation(adminDb, r.invitation.id), { ok: true })
      const preview = await getInvitationByToken(adminDb, 'c-tok')
      assert.equal(preview?.status, 'expired')
      assert.deepEqual(await cancelInvitation(adminDb, uuidv7()), { ok: false, code: 'NOT_FOUND' })
    })
  })
})
