import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import {
  listTenants, createTenantAsAdmin, getTenantDetail, updateTenant,
  deleteTenant, setMemberRole, removeMember,
} from '../admin.ts'

async function seedUser(adminDb: any, email: string) {
  const id = uuidv7()
  await adminDb.insert(users).values({ id, email, name: email.split('@')[0] })
  return id
}

describe('createTenantAsAdmin', () => {
  test('creates an active non-personal tenant + TENANT_ADMIN member', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      assert.equal(r.ok, true)
      if (!r.ok) return
      assert.equal(r.tenant.status, 'active')
      assert.equal(r.tenant.isPersonal, false)
      const m = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.tenantId, r.tenant.id))
      assert.equal(m.length, 1)
      assert.equal(m[0].role, 'TENANT_ADMIN')
    })
  })
  test('SLUG_TAKEN on duplicate slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme2', slug: 'acme', createdBy: owner })
      assert.deepEqual(r, { ok: false, code: 'SLUG_TAKEN' })
    })
  })
})

describe('listTenants', () => {
  test('paginates, counts members, resolves creator identity', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      assert.equal(r.ok, true)
      const { tenants: list, total } = await listTenants(adminDb, { page: 1, limit: 10 })
      assert.equal(total, 1)
      assert.equal(list[0].user_count, 1)
      assert.equal(list[0].creator_email, 'owner@acme.com')
    })
  })
  test('filters by status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (r.ok) await updateTenant(adminDb, r.tenant.id, { status: 'suspended' })
      const active = await listTenants(adminDb, { page: 1, limit: 10, status: 'active' })
      assert.equal(active.total, 0)
      const suspended = await listTenants(adminDb, { page: 1, limit: 10, status: 'suspended' })
      assert.equal(suspended.total, 1)
    })
  })
})

describe('getTenantDetail / updateTenant', () => {
  test('detail returns tenant + member count; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      assert.equal(r.ok, true)
      if (!r.ok) return
      const detail = await getTenantDetail(adminDb, r.tenant.id)
      assert.equal(detail?.user_count, 1)
      assert.equal(detail?.tenant.slug, 'a')
      assert.equal(await getTenantDetail(adminDb, uuidv7()), null)
    })
  })
  test('updateTenant changes name/status; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      const updated = await updateTenant(adminDb, r.tenant.id, { name: 'A2', status: 'trial' })
      assert.equal(updated?.name, 'A2')
      assert.equal(updated?.status, 'trial')
      assert.equal(await updateTenant(adminDb, uuidv7(), { name: 'x' }), null)
    })
  })
})

describe('deleteTenant', () => {
  test('cascades members + invitations; returns true (false when missing)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId: r.tenant.id, email: 'x@a.com', token: uuidv7(),
        role: 'MEMBER', status: 'pending', expiresAt: new Date(Date.now() + 3600000), createdBy: owner,
      })
      assert.equal(await deleteTenant(adminDb, r.tenant.id), true)
      assert.equal((await adminDb.select().from(tenants).where(eq(tenants.id, r.tenant.id))).length, 0)
      assert.equal((await adminDb.select().from(tenantMembers).where(eq(tenantMembers.tenantId, r.tenant.id))).length, 0)
      assert.equal((await adminDb.select().from(invitations).where(eq(invitations.tenantId, r.tenant.id))).length, 0)
      assert.equal(await deleteTenant(adminDb, uuidv7()), false)
    })
  })
})

describe('setMemberRole / removeMember', () => {
  test('setMemberRole updates role; NOT_MEMBER when absent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      assert.deepEqual(await setMemberRole(adminDb, r.tenant.id, guest, 'MEMBER'), { ok: false, code: 'NOT_MEMBER' })
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })
      assert.deepEqual(await setMemberRole(adminDb, r.tenant.id, guest, 'TENANT_ADMIN'), { ok: true })
      const m = await adminDb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, r.tenant.id), eq(tenantMembers.userId, guest)))
      assert.equal(m[0].role, 'TENANT_ADMIN')
    })
  })
  test('removeMember deletes the row; NOT_MEMBER when absent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      assert.deepEqual(await removeMember(adminDb, r.tenant.id, guest), { ok: false, code: 'NOT_MEMBER' })
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })
      assert.deepEqual(await removeMember(adminDb, r.tenant.id, guest), { ok: true })
      assert.equal((await adminDb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, r.tenant.id), eq(tenantMembers.userId, guest)))).length, 0)
    })
  })
})
