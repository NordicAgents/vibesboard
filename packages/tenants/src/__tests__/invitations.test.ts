import { describe, it, expect } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  getInvitationByToken,
  getInvitationTenant,
  cancelInvitation,
} from '../invitations.ts'

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
    id: tenantId,
    name: 'Acme',
    slug: 'acme',
    createdBy: ownerId,
    isPersonal: false,
  })
  return { ownerId, inviteeId, tenantId }
}

describe('acceptInvitation', () => {
  it('adds the member with the invited role and marks the invite accepted', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId,
        email: 'guest@acme.com',
        token,
        role: 'MEMBER',
        status: 'pending',
        expiresAt: new Date(Date.now() + HOUR),
        createdBy: ownerId,
      })

      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })

      expect(result).toEqual({ ok: true, tenantId })

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, inviteeId), eq(tenantMembers.tenantId, tenantId)))
      expect(ms.length).toBe(1)
      expect(ms[0].role).toBe('MEMBER')

      const inv = await adminDb.select().from(invitations).where(eq(invitations.token, token))
      expect(inv[0].status).toBe('accepted')
      expect(inv[0].acceptedAt).not.toBeNull()
    })
  })

  it('preserves the invited role as TENANT_ADMIN when accepting', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId,
        email: 'guest@acme.com',
        token,
        role: 'TENANT_ADMIN',
        status: 'pending',
        expiresAt: new Date(Date.now() + HOUR),
        createdBy: ownerId,
      })

      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      expect(result).toEqual({ ok: true, tenantId })

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, inviteeId), eq(tenantMembers.tenantId, tenantId)))
      expect(ms[0].role).toBe('TENANT_ADMIN')
    })
  })

  it('NOT_FOUND for an unknown token', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { inviteeId } = await seedTenantAndUser(adminDb)
      const result = await acceptInvitation(adminDb, { token: 'nope', userId: inviteeId })
      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' })
    })
  })

  it('EXPIRED past the expiry time and adds no membership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId,
        email: 'guest@acme.com',
        token,
        role: 'MEMBER',
        status: 'pending',
        expiresAt: new Date(Date.now() - HOUR),
        createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      expect(result).toEqual({ ok: false, code: 'EXPIRED' })

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, inviteeId), eq(tenantMembers.tenantId, tenantId)))
      expect(ms.length).toBe(0)
    })
  })

  it('ALREADY_ACCEPTED when the invite was already used', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId,
        email: 'guest@acme.com',
        token,
        role: 'MEMBER',
        status: 'accepted',
        expiresAt: new Date(Date.now() + HOUR),
        acceptedAt: new Date(),
        createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      expect(result).toEqual({ ok: false, code: 'ALREADY_ACCEPTED' })
    })
  })

  it('ALREADY_MEMBER when the user is already in the tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      await adminDb.insert(tenantMembers).values({ tenantId, userId: inviteeId, role: 'MEMBER' })
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId,
        email: 'guest@acme.com',
        token,
        role: 'MEMBER',
        status: 'pending',
        expiresAt: new Date(Date.now() + HOUR),
        createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      expect(result).toEqual({ ok: false, code: 'ALREADY_MEMBER' })
    })
  })

  it('INVALID for a non-pending, non-accepted invitation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId,
        email: 'guest@acme.com',
        token,
        role: 'MEMBER',
        status: 'expired',
        expiresAt: new Date(Date.now() + HOUR),
        createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      expect(result).toEqual({ ok: false, code: 'INVALID' })
    })
  })
})

describe('createInvitation / listInvitations', () => {
  it('creates a pending invitation and lists it (lowercases email)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, {
        tenantId,
        email: 'New@Acme.com',
        role: 'MEMBER',
        token: 'tok-1',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600000),
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.invitation.email).toBe('new@acme.com')
      expect(r.invitation.role).toBe('MEMBER')
      expect(r.invitation.status).toBe('pending')

      const list = await listInvitations(adminDb, tenantId)
      expect(list.length).toBe(1)
      expect(list[0].status).toBe('pending')
      expect(list[0].email).toBe('new@acme.com')
    })
  })

  it('ALREADY_MEMBER when email is an existing member', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await adminDb.insert(tenantMembers).values({ tenantId, userId: ownerId, role: 'TENANT_ADMIN' })
      const r = await createInvitation(adminDb, {
        tenantId,
        email: 'owner@acme.com',
        role: 'MEMBER',
        token: 'tok-2',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      expect(r).toEqual({ ok: false, code: 'ALREADY_MEMBER' })
    })
  })

  it('ALREADY_MEMBER matches existing member email case-insensitively', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await adminDb.insert(tenantMembers).values({ tenantId, userId: ownerId, role: 'TENANT_ADMIN' })
      const r = await createInvitation(adminDb, {
        tenantId,
        email: 'OWNER@ACME.COM',
        role: 'MEMBER',
        token: 'tok-ci',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      expect(r).toEqual({ ok: false, code: 'ALREADY_MEMBER' })
    })
  })

  it('PENDING_EXISTS on duplicate pending invite', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, {
        tenantId,
        email: 'dup@x.com',
        role: 'MEMBER',
        token: 't1',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      const r = await createInvitation(adminDb, {
        tenantId,
        email: 'dup@x.com',
        role: 'MEMBER',
        token: 't2',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      expect(r).toEqual({ ok: false, code: 'PENDING_EXISTS' })
    })
  })

  it('listInvitations is scoped to the requested tenant only (cross-tenant isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const otherTenant = uuidv7()
      await adminDb.insert(tenants).values({
        id: otherTenant,
        name: 'Other',
        slug: 'other',
        createdBy: ownerId,
        isPersonal: false,
      })
      await createInvitation(adminDb, {
        tenantId,
        email: 'mine@x.com',
        role: 'MEMBER',
        token: 'mine-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      await createInvitation(adminDb, {
        tenantId: otherTenant,
        email: 'theirs@x.com',
        role: 'MEMBER',
        token: 'theirs-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })

      const mine = await listInvitations(adminDb, tenantId)
      expect(mine.length).toBe(1)
      expect(mine[0].email).toBe('mine@x.com')

      const theirs = await listInvitations(adminDb, otherTenant)
      expect(theirs.length).toBe(1)
      expect(theirs[0].email).toBe('theirs@x.com')
    })
  })

  it('the same email may be pending in two different tenants independently', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const otherTenant = uuidv7()
      await adminDb.insert(tenants).values({
        id: otherTenant,
        name: 'Other',
        slug: 'other',
        createdBy: ownerId,
        isPersonal: false,
      })

      const a = await createInvitation(adminDb, {
        tenantId,
        email: 'shared@x.com',
        role: 'MEMBER',
        token: 'a-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      const b = await createInvitation(adminDb, {
        tenantId: otherTenant,
        email: 'shared@x.com',
        role: 'MEMBER',
        token: 'b-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })

      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
    })
  })
})

describe('getInvitationByToken / getInvitationTenant / cancelInvitation', () => {
  it('preview returns tenant + inviter; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, {
        tenantId,
        email: 'p@x.com',
        role: 'MEMBER',
        token: 'prev-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      const preview = await getInvitationByToken(adminDb, 'prev-tok')
      expect(preview?.tenant_id).toBe(tenantId)
      expect(preview?.tenant_name).toBe('Acme')
      expect(preview?.invited_by_email).toBe('owner@acme.com')
      expect(preview?.status).toBe('pending')
      expect(preview?.email).toBe('p@x.com')
      expect(preview?.accepted_at).toBeNull()
      expect(await getInvitationByToken(adminDb, 'missing')).toBeNull()
    })
  })

  it('past-expiry pending preview flips to expired (and persists)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, {
        tenantId,
        email: 'e@x.com',
        role: 'MEMBER',
        token: 'exp-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() - 3600000),
      })
      const preview = await getInvitationByToken(adminDb, 'exp-tok')
      expect(preview?.status).toBe('expired')

      const rows = await adminDb.select().from(invitations).where(eq(invitations.token, 'exp-tok'))
      expect(rows[0].status).toBe('expired')
    })
  })

  it('getInvitationTenant returns the tenant + status, or null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, {
        tenantId,
        email: 'gt@x.com',
        role: 'MEMBER',
        token: 'gt-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      if (!r.ok) return
      expect(await getInvitationTenant(adminDb, r.invitation.id)).toEqual({
        tenantId,
        status: 'pending',
      })
      expect(await getInvitationTenant(adminDb, uuidv7())).toBeNull()
    })
  })

  it('cancelInvitation expires a pending invite; NOT_FOUND when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, {
        tenantId,
        email: 'c@x.com',
        role: 'MEMBER',
        token: 'c-tok',
        createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      if (!r.ok) return
      expect(await cancelInvitation(adminDb, r.invitation.id)).toEqual({ ok: true })
      const preview = await getInvitationByToken(adminDb, 'c-tok')
      expect(preview?.status).toBe('expired')
      expect(await cancelInvitation(adminDb, uuidv7())).toEqual({ ok: false, code: 'NOT_FOUND' })
    })
  })

  it('cancelInvitation refuses an already-accepted invite and reports its tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const id = uuidv7()
      await adminDb.insert(invitations).values({
        id,
        tenantId,
        email: 'done@x.com',
        token: 'done-tok',
        role: 'MEMBER',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 3600000),
        acceptedAt: new Date(),
        createdBy: ownerId,
      })
      expect(await cancelInvitation(adminDb, id)).toEqual({
        ok: false,
        code: 'ALREADY_ACCEPTED',
        tenantId,
      })
    })
  })
})
