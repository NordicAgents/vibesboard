import { describe, it, expect } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import {
  listTenants,
  createTenantAsAdmin,
  getTenantDetail,
  updateTenant,
  deleteTenant,
  setMemberRole,
  removeMember,
  listTenantMembers,
} from '../admin.ts'

async function seedUser(adminDb: any, email: string) {
  const id = uuidv7()
  await adminDb.insert(users).values({ id, email, name: email.split('@')[0] })
  return id
}

describe('createTenantAsAdmin', () => {
  it('creates an active non-personal tenant + TENANT_ADMIN member', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.tenant.status).toBe('active')
      expect(r.tenant.isPersonal).toBe(false)
      expect(r.tenant.createdBy).toBe(owner)
      const m = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.tenantId, r.tenant.id))
      expect(m.length).toBe(1)
      expect(m[0].role).toBe('TENANT_ADMIN')
      expect(m[0].userId).toBe(owner)
    })
  })

  it('SLUG_TAKEN on duplicate slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme2', slug: 'acme', createdBy: owner })
      expect(r).toEqual({ ok: false, code: 'SLUG_TAKEN' })
    })
  })
})

describe('listTenants', () => {
  it('paginates, counts members, resolves creator identity', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      expect(r.ok).toBe(true)
      const { tenants: list, total } = await listTenants(adminDb, { page: 1, limit: 10 })
      expect(total).toBe(1)
      expect(list[0].user_count).toBe(1)
      expect(list[0].creator_email).toBe('owner@acme.com')
      expect(list[0].creator_name).toBe('owner')
    })
  })

  it('filters by status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (r.ok) await updateTenant(adminDb, r.tenant.id, { status: 'suspended' })
      const active = await listTenants(adminDb, { page: 1, limit: 10, status: 'active' })
      expect(active.total).toBe(0)
      const suspended = await listTenants(adminDb, { page: 1, limit: 10, status: 'suspended' })
      expect(suspended.total).toBe(1)
    })
  })

  it('paginates: second page returns the next slice with no overlap', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      for (let i = 0; i < 3; i++) {
        await createTenantAsAdmin(adminDb, { name: `T${i}`, slug: `t-${i}`, createdBy: owner })
      }

      const page1 = await listTenants(adminDb, { page: 1, limit: 2 })
      expect(page1.total).toBe(3)
      expect(page1.tenants.length).toBe(2)

      const page2 = await listTenants(adminDb, { page: 2, limit: 2 })
      expect(page2.tenants.length).toBe(1)

      const ids1 = new Set(page1.tenants.map((t) => t.id))
      expect(ids1.has(page2.tenants[0].id)).toBe(false)
    })
  })
})

describe('getTenantDetail / updateTenant', () => {
  it('detail returns tenant + member count; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const detail = await getTenantDetail(adminDb, r.tenant.id)
      expect(detail?.user_count).toBe(1)
      expect(detail?.tenant.slug).toBe('a')
      expect(await getTenantDetail(adminDb, uuidv7())).toBeNull()
    })
  })

  it('updateTenant changes name/status; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      const updated = await updateTenant(adminDb, r.tenant.id, { name: 'A2', status: 'trial' })
      expect(updated?.name).toBe('A2')
      expect(updated?.status).toBe('trial')
      expect(await updateTenant(adminDb, uuidv7(), { name: 'x' })).toBeNull()
    })
  })

  it('updateTenant ignores an invalid status value (keeps current status)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      const updated = await updateTenant(adminDb, r.tenant.id, { name: 'Renamed', status: 'bogus' })
      expect(updated?.name).toBe('Renamed')
      expect(updated?.status).toBe('active')
    })
  })
})

describe('deleteTenant', () => {
  it('cascades members + invitations; returns true (false when missing)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      await adminDb.insert(invitations).values({
        id: uuidv7(),
        tenantId: r.tenant.id,
        email: 'x@a.com',
        token: uuidv7(),
        role: 'MEMBER',
        status: 'pending',
        expiresAt: new Date(Date.now() + 3600000),
        createdBy: owner,
      })
      expect(await deleteTenant(adminDb, r.tenant.id)).toBe(true)
      expect((await adminDb.select().from(tenants).where(eq(tenants.id, r.tenant.id))).length).toBe(0)
      expect(
        (await adminDb.select().from(tenantMembers).where(eq(tenantMembers.tenantId, r.tenant.id)))
          .length,
      ).toBe(0)
      expect(
        (await adminDb.select().from(invitations).where(eq(invitations.tenantId, r.tenant.id)))
          .length,
      ).toBe(0)
      expect(await deleteTenant(adminDb, uuidv7())).toBe(false)
    })
  })

  it('deleting one tenant leaves a sibling tenant and its members intact (isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const keep = await createTenantAsAdmin(adminDb, { name: 'Keep', slug: 'keep', createdBy: owner })
      const drop = await createTenantAsAdmin(adminDb, { name: 'Drop', slug: 'drop', createdBy: owner })
      if (!keep.ok || !drop.ok) return

      expect(await deleteTenant(adminDb, drop.tenant.id)).toBe(true)

      expect((await adminDb.select().from(tenants).where(eq(tenants.id, keep.tenant.id))).length).toBe(1)
      const members = await adminDb
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.tenantId, keep.tenant.id))
      expect(members.length).toBe(1)
    })
  })
})

describe('setMemberRole / removeMember', () => {
  it('setMemberRole updates role; NOT_MEMBER when absent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      expect(await setMemberRole(adminDb, r.tenant.id, guest, 'MEMBER')).toEqual({
        ok: false,
        code: 'NOT_MEMBER',
      })
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })
      expect(await setMemberRole(adminDb, r.tenant.id, guest, 'TENANT_ADMIN')).toEqual({ ok: true })
      const m = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, r.tenant.id), eq(tenantMembers.userId, guest)))
      expect(m[0].role).toBe('TENANT_ADMIN')
    })
  })

  it('removeMember deletes the row; NOT_MEMBER when absent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      expect(await removeMember(adminDb, r.tenant.id, guest)).toEqual({ ok: false, code: 'NOT_MEMBER' })
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })
      expect(await removeMember(adminDb, r.tenant.id, guest)).toEqual({ ok: true })
      expect(
        (
          await adminDb
            .select()
            .from(tenantMembers)
            .where(and(eq(tenantMembers.tenantId, r.tenant.id), eq(tenantMembers.userId, guest)))
        ).length,
      ).toBe(0)
    })
  })

  it('setMemberRole on tenant A does not affect the same user in tenant B (cross-tenant isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const a = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      const b = await createTenantAsAdmin(adminDb, { name: 'B', slug: 'b', createdBy: owner })
      if (!a.ok || !b.ok) return
      await adminDb.insert(tenantMembers).values([
        { tenantId: a.tenant.id, userId: guest, role: 'MEMBER' },
        { tenantId: b.tenant.id, userId: guest, role: 'MEMBER' },
      ])

      expect(await setMemberRole(adminDb, a.tenant.id, guest, 'TENANT_ADMIN')).toEqual({ ok: true })

      const inA = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, a.tenant.id), eq(tenantMembers.userId, guest)))
      const inB = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, b.tenant.id), eq(tenantMembers.userId, guest)))
      expect(inA[0].role).toBe('TENANT_ADMIN')
      expect(inB[0].role).toBe('MEMBER')
    })
  })

  it('removeMember from tenant A leaves the same user a member of tenant B', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const a = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      const b = await createTenantAsAdmin(adminDb, { name: 'B', slug: 'b', createdBy: owner })
      if (!a.ok || !b.ok) return
      await adminDb.insert(tenantMembers).values([
        { tenantId: a.tenant.id, userId: guest, role: 'MEMBER' },
        { tenantId: b.tenant.id, userId: guest, role: 'MEMBER' },
      ])

      expect(await removeMember(adminDb, a.tenant.id, guest)).toEqual({ ok: true })

      const inA = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, a.tenant.id), eq(tenantMembers.userId, guest)))
      const inB = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, b.tenant.id), eq(tenantMembers.userId, guest)))
      expect(inA.length).toBe(0)
      expect(inB.length).toBe(1)
    })
  })
})

describe('listTenantMembers', () => {
  it('lists members joined with user profile (email/name)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const guest = await seedUser(adminDb, 'guest@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })

      const members = await listTenantMembers(adminDb, r.tenant.id)
      expect(members.length).toBe(2)
      const byEmail = Object.fromEntries(members.map((m) => [m.email, m]))
      expect(byEmail['owner@acme.com'].role).toBe('TENANT_ADMIN')
      expect(byEmail['guest@acme.com'].role).toBe('MEMBER')
      expect(byEmail['guest@acme.com'].tenant_id).toBe(r.tenant.id)
      expect(typeof byEmail['owner@acme.com'].created_at).toBe('string')
    })
  })

  it('only returns members of the requested tenant (cross-tenant isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const a = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      const b = await createTenantAsAdmin(adminDb, { name: 'B', slug: 'b', createdBy: owner })
      if (!a.ok || !b.ok) return
      const onlyB = await seedUser(adminDb, 'onlyb@acme.com')
      await adminDb.insert(tenantMembers).values({ tenantId: b.tenant.id, userId: onlyB, role: 'MEMBER' })

      const membersA = await listTenantMembers(adminDb, a.tenant.id)
      const emailsA = membersA.map((m) => m.email)
      expect(emailsA).toContain('owner@acme.com')
      expect(emailsA).not.toContain('onlyb@acme.com')

      const membersB = await listTenantMembers(adminDb, b.tenant.id)
      const emailsB = membersB.map((m) => m.email)
      expect(emailsB).toContain('onlyb@acme.com')
    })
  })

  it('returns an empty list for a tenant with no members', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const tenantId = uuidv7()
      await adminDb.insert(tenants).values({
        id: tenantId,
        name: 'Empty',
        slug: 'empty',
        createdBy: owner,
        isPersonal: false,
      })
      expect(await listTenantMembers(adminDb, tenantId)).toEqual([])
    })
  })
})
