import { describe, it, expect, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'
import {
  getUserRole,
  isSuperAdmin,
  isTenantAdmin,
  canManageTenant,
  isMemberOfTenant,
  hasTenantAdminAccess,
} from './permissions.ts'

// IMPORTANT: permissions.ts calls getMigrateDb(), which connects to the REAL
// vibesboard_dev public schema (NOT a withTestDb per-test schema). So these
// tests seed rows with unique UUIDs and remove exactly those rows afterwards.
// Cleanup order respects FKs: tenant_members -> tenants -> users.
//
// NOTE: tenant_members has a COMPOSITE primary key (tenantId, userId) and NO
// `id` column, so memberships are deleted by userId (every membership we create
// here belongs to a freshly-minted, test-owned user id).
describe('permissions (db-backed against public schema)', () => {
  const created = { tenants: [] as string[], users: [] as string[] }

  afterEach(async () => {
    const db = getMigrateDb()
    if (created.users.length) {
      await db.delete(tenantMembers).where(inArray(tenantMembers.userId, created.users))
    }
    for (const id of created.tenants) await db.delete(tenants).where(eq(tenants.id, id))
    for (const id of created.users) await db.delete(users).where(eq(users.id, id))
    created.tenants = []
    created.users = []
  })

  async function seedUser(opts: { isSuperAdmin?: boolean } = {}): Promise<string> {
    const db = getMigrateDb()
    const id = randomUUID()
    created.users.push(id)
    await db.insert(users).values({
      id,
      email: `${id}@perm.test`,
      name: 'Perm User',
      isSuperAdmin: opts.isSuperAdmin ?? false,
    })
    return id
  }

  async function seedTenant(createdBy: string): Promise<string> {
    const db = getMigrateDb()
    const id = randomUUID()
    created.tenants.push(id)
    await db.insert(tenants).values({
      id,
      name: 'Perm Tenant',
      slug: `perm-${id}`,
      createdBy,
      isPersonal: false,
    })
    return id
  }

  async function seedMembership(
    userId: string,
    tenantId: string,
    role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER',
  ): Promise<void> {
    const db = getMigrateDb()
    // tenant_members has composite PK (tenantId, userId) — no `id` column.
    await db.insert(tenantMembers).values({ userId, tenantId, role })
  }

  describe('getUserRole', () => {
    it('returns null when the user is not a member of the tenant', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      expect(await getUserRole(userId, tenantId)).toBe(null)
    })

    it('returns the membership role', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'TENANT_ADMIN')
      expect(await getUserRole(userId, tenantId)).toBe('TENANT_ADMIN')
    })

    it('is tenant-scoped: a role in tenant A is not seen in tenant B', async () => {
      const userId = await seedUser()
      const tenantA = await seedTenant(userId)
      const tenantB = await seedTenant(userId)
      await seedMembership(userId, tenantA, 'MEMBER')
      expect(await getUserRole(userId, tenantA)).toBe('MEMBER')
      expect(await getUserRole(userId, tenantB)).toBe(null)
    })
  })

  describe('isSuperAdmin', () => {
    it('is true when users.isSuperAdmin is set', async () => {
      const userId = await seedUser({ isSuperAdmin: true })
      expect(await isSuperAdmin(userId)).toBe(true)
    })

    it('falls back to true when the user has a SUPER_ADMIN membership role', async () => {
      const userId = await seedUser({ isSuperAdmin: false })
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'SUPER_ADMIN')
      expect(await isSuperAdmin(userId)).toBe(true)
    })

    it('is false for a plain user with only a MEMBER role', async () => {
      const userId = await seedUser({ isSuperAdmin: false })
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'MEMBER')
      expect(await isSuperAdmin(userId)).toBe(false)
    })

    it('is false for an unknown user id', async () => {
      expect(await isSuperAdmin(randomUUID())).toBe(false)
    })
  })

  describe('isTenantAdmin / canManageTenant', () => {
    it('is true for TENANT_ADMIN', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'TENANT_ADMIN')
      expect(await isTenantAdmin(userId, tenantId)).toBe(true)
      expect(await canManageTenant(userId, tenantId)).toBe(true)
    })

    it('is true for SUPER_ADMIN role on the membership', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'SUPER_ADMIN')
      expect(await isTenantAdmin(userId, tenantId)).toBe(true)
    })

    it('is false for a plain MEMBER', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'MEMBER')
      expect(await isTenantAdmin(userId, tenantId)).toBe(false)
      expect(await canManageTenant(userId, tenantId)).toBe(false)
    })

    it('is false for a non-member', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      expect(await isTenantAdmin(userId, tenantId)).toBe(false)
    })
  })

  describe('isMemberOfTenant', () => {
    it('is true for any membership role', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'MEMBER')
      expect(await isMemberOfTenant(userId, tenantId)).toBe(true)
    })

    it('is false for a non-member', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      expect(await isMemberOfTenant(userId, tenantId)).toBe(false)
    })
  })

  describe('hasTenantAdminAccess (any-tenant admin check)', () => {
    it('is true when the user holds TENANT_ADMIN in any tenant', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'TENANT_ADMIN')
      expect(await hasTenantAdminAccess(userId)).toBe(true)
    })

    it('is true when the user holds SUPER_ADMIN in any tenant', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'SUPER_ADMIN')
      expect(await hasTenantAdminAccess(userId)).toBe(true)
    })

    it('is false when the user is only a MEMBER', async () => {
      const userId = await seedUser()
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'MEMBER')
      expect(await hasTenantAdminAccess(userId)).toBe(false)
    })

    it('is false when the user has no memberships', async () => {
      const userId = await seedUser()
      expect(await hasTenantAdminAccess(userId)).toBe(false)
    })

    it('is true for a platform super admin who only holds MEMBER in their tenant', async () => {
      // requireSuperAdmin() (used by e.g. /api/tenants/[id]/config) already
      // grants a platform super admin full access to any tenant regardless
      // of their per-tenant role, so this must agree — see QA report
      // docs/qa/pre-release-qa-report-2026-08-13.md.
      const userId = await seedUser({ isSuperAdmin: true })
      const tenantId = await seedTenant(userId)
      await seedMembership(userId, tenantId, 'MEMBER')
      expect(await hasTenantAdminAccess(userId)).toBe(true)
    })
  })
})
