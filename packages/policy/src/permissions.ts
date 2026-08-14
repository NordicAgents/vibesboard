import { eq, and, inArray } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { users, tenantMembers } from '@vibesboard/adapter-postgres/schema'

export type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'

// Identity-adjacent lookups use the BYPASSRLS migrate role: a user querying
// "what tenants am I in?" runs before any tenant GUC is set, so the standard
// _iso policies (tenant_id = current_tenant_id) would return zero rows.

export async function getUserRole(
  userId: string,
  tenantId: string,
): Promise<Role | null> {
  const rows = await getMigrateDb()
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
    .limit(1)
  return (rows[0]?.role as Role) ?? null
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const rows = await getMigrateDb()
    .select({ isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (rows[0]?.isSuperAdmin === true) return true

  // Fallback: SUPER_ADMIN role in any tenant
  const memberRows = await getMigrateDb()
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.role, 'SUPER_ADMIN')))
    .limit(1)
  return memberRows.length > 0
}

export async function isTenantAdmin(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const role = await getUserRole(userId, tenantId)
  return role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN'
}

export async function canManageTenant(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  return isTenantAdmin(userId, tenantId)
}

export async function isMemberOfTenant(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await getMigrateDb()
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
    .limit(1)
  return rows.length > 0
}

export async function hasTenantAdminAccess(userId: string): Promise<boolean> {
  // A platform super admin (users.isSuperAdmin) manages every tenant's
  // config via requireSuperAdmin() regardless of their per-tenant
  // tenant_members role, so this must agree — otherwise a platform super
  // admin who is only a MEMBER row in a given tenant sees a false
  // "no admin access" gate for a workspace they can actually fully manage.
  if (await isSuperAdmin(userId)) return true

  const rows = await getMigrateDb()
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.userId, userId),
        inArray(tenantMembers.role, ['TENANT_ADMIN', 'SUPER_ADMIN']),
      ),
    )
    .limit(1)
  return rows.length > 0
}
