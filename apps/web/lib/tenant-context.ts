import { cookies } from 'next/headers'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  tenants as tenantsTable,
  tenantMembers as tenantMembersTable,
  tenantBranding as tenantBrandingTable,
  users as usersTable
} from '@vibesboard/adapter-postgres/schema'
import {
  type TenantDocument,
  type TenantBrandingDocument
} from '@vibesboard/contracts'
import { isUuid } from '@vibesboard/utils'

/** Lightweight member summary for display in the tenant switcher */
export interface MemberSummary {
  userId: string
  email: string | null
  name: string | null
}

/** Tenant document enriched with member info for the switcher UI */
export interface TenantWithMembers extends TenantDocument {
  memberCount: number
  members: MemberSummary[]
}

const ACTIVE_TENANT_COOKIE = 'active_tenant_id'

// Tenant resolution is identity-adjacent: a user asking "which tenants am I
// a member of?" runs before any tenant GUC is set, so the standard _iso RLS
// policies (tenant_id = current_tenant_id) would return zero rows. We use
// the BYPASSRLS migrate role for these lookups; the per-row filter is
// expressed explicitly in the WHERE clause (user_id / tenant_id eq).

// Map a Postgres tenants row to the legacy TenantDocument shape with ISO-
// string timestamps (the existing UI / API responses expect strings).
function rowToTenantDocument(row: {
  id: string
  name: string
  slug: string
  status: string
  createdBy: string | null
  isPersonal: boolean
  googlePlaceId: string | null
  createdAt: Date
  updatedAt: Date
}): TenantDocument {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as TenantDocument['status'],
    createdBy: row.createdBy ?? '',
    isPersonal: row.isPersonal,
    googlePlaceId: row.googlePlaceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function getActiveTenantId(): Promise<string | null> {
  const cookieStore = await cookies()
  const value = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value || null
  // Ignore a stale/invalid active-tenant cookie (e.g. a legacy non-UUID ID
  // left over from a pre-Postgres session). tenant_id is a uuid column, so a
  // non-uuid value would otherwise throw on every query and 500 every page
  // with no way to recover. Treat it as absent and let callers re-resolve.
  if (value && !isUuid(value)) return null
  return value
}

export async function setActiveTenantId(tenantId: string) {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  })
}

export async function clearActiveTenantId() {
  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_TENANT_COOKIE)
}

export async function getActiveTenant(userId?: string): Promise<string | null> {
  let tenantId = await getActiveTenantId()

  if (!tenantId && userId) {
    tenantId = await ensureActiveTenant(userId)
  }

  return tenantId
}

export async function getUserTenants(
  userId: string
): Promise<TenantDocument[]> {
  const rows = await getMigrateDb()
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      status: tenantsTable.status,
      createdBy: tenantsTable.createdBy,
      isPersonal: tenantsTable.isPersonal,
      googlePlaceId: tenantsTable.googlePlaceId,
      createdAt: tenantsTable.createdAt,
      updatedAt: tenantsTable.updatedAt
    })
    .from(tenantsTable)
    .innerJoin(
      tenantMembersTable,
      eq(tenantsTable.id, tenantMembersTable.tenantId)
    )
    .where(eq(tenantMembersTable.userId, userId))
    .orderBy(desc(tenantsTable.createdAt))

  return rows.map(rowToTenantDocument)
}

/**
 * Tenants the user can administer (member with TENANT_ADMIN or SUPER_ADMIN
 * role). Mirrors getUserTenants with a role filter — used by the settings
 * layout to decide which workspaces are manageable.
 */
export async function getManageableTenants(
  userId: string
): Promise<TenantDocument[]> {
  const rows = await getMigrateDb()
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      status: tenantsTable.status,
      createdBy: tenantsTable.createdBy,
      isPersonal: tenantsTable.isPersonal,
      googlePlaceId: tenantsTable.googlePlaceId,
      createdAt: tenantsTable.createdAt,
      updatedAt: tenantsTable.updatedAt
    })
    .from(tenantsTable)
    .innerJoin(
      tenantMembersTable,
      eq(tenantsTable.id, tenantMembersTable.tenantId)
    )
    .where(
      and(
        eq(tenantMembersTable.userId, userId),
        inArray(tenantMembersTable.role, ['SUPER_ADMIN', 'TENANT_ADMIN'])
      )
    )
    .orderBy(desc(tenantsTable.createdAt))

  return rows.map(rowToTenantDocument)
}

export async function getTenantById(
  tenantId: string
): Promise<TenantDocument | null> {
  if (!isUuid(tenantId)) return null
  const rows = await getMigrateDb()
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      status: tenantsTable.status,
      createdBy: tenantsTable.createdBy,
      isPersonal: tenantsTable.isPersonal,
      googlePlaceId: tenantsTable.googlePlaceId,
      createdAt: tenantsTable.createdAt,
      updatedAt: tenantsTable.updatedAt
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1)

  if (rows.length === 0) return null
  return rowToTenantDocument(rows[0])
}

export async function getTenantBySlug(
  slug: string
): Promise<TenantDocument | null> {
  const rows = await getMigrateDb()
    .select({
      id: tenantsTable.id,
      name: tenantsTable.name,
      slug: tenantsTable.slug,
      status: tenantsTable.status,
      createdBy: tenantsTable.createdBy,
      isPersonal: tenantsTable.isPersonal,
      googlePlaceId: tenantsTable.googlePlaceId,
      createdAt: tenantsTable.createdAt,
      updatedAt: tenantsTable.updatedAt
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1)
  if (rows.length === 0) return null
  return rowToTenantDocument(rows[0])
}

export async function getActiveTenantBranding(): Promise<TenantBrandingDocument | null> {
  const tenantId = await getActiveTenantId()
  if (!tenantId) return null

  const rows = await getMigrateDb()
    .select()
    .from(tenantBrandingTable)
    .where(eq(tenantBrandingTable.tenantId, tenantId))
    .limit(1)

  if (rows.length === 0) return null
  return rows[0] as unknown as TenantBrandingDocument
}

export async function getTenantContext(userId: string) {
  const tenantId = await getActiveTenantId()
  if (!tenantId) return null

  const tenant = await getTenantById(tenantId)
  if (!tenant) return null

  const brandingRows = await getMigrateDb()
    .select()
    .from(tenantBrandingTable)
    .where(eq(tenantBrandingTable.tenantId, tenantId))
    .limit(1)
  const branding =
    brandingRows.length > 0
      ? (brandingRows[0] as unknown as TenantBrandingDocument)
      : null

  const memberRows = await getMigrateDb()
    .select({ role: tenantMembersTable.role })
    .from(tenantMembersTable)
    .where(
      and(
        eq(tenantMembersTable.tenantId, tenantId),
        eq(tenantMembersTable.userId, userId)
      )
    )
    .limit(1)
  const role = memberRows[0]?.role ?? null

  return { tenant, branding, role }
}

export async function ensureActiveTenant(
  userId: string
): Promise<string | null> {
  const cookieTenantId = await getActiveTenantId()

  // If a cookie tenant exists, verify the user is still a member.
  if (cookieTenantId) {
    const rows = await getMigrateDb()
      .select({ tenantId: tenantMembersTable.tenantId })
      .from(tenantMembersTable)
      .where(
        and(
          eq(tenantMembersTable.tenantId, cookieTenantId),
          eq(tenantMembersTable.userId, userId)
        )
      )
      .limit(1)
    if (rows.length > 0) return cookieTenantId
  }

  // Otherwise pick the user's personal tenant if one exists; fall back to
  // the most recently-created tenant they belong to.
  const list = await getUserTenants(userId)
  const personal = list.find(t => t.isPersonal)
  const chosen = personal ?? list[0]
  if (chosen) return chosen.id

  // Last resort: create a personal tenant. In the Better Auth flow this is
  // already done by the onUserCreateAfter hook, so this branch only fires
  // for users that pre-date the hook or had their tenant deleted.
  try {
    return await ensurePersonalTenant(userId)
  } catch (error) {
    console.error('Failed to ensure personal tenant:', error)
    return null
  }
}

/**
 * Create a personal tenant + TENANT_ADMIN membership for a user that doesn't
 * have one. Idempotent: returns the existing personal tenant if found.
 */
export async function ensurePersonalTenant(userId: string): Promise<string> {
  const existing = await getUserTenants(userId)
  const personal = existing.find(t => t.isPersonal)
  if (personal) return personal.id

  const userRows = await getMigrateDb()
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1)
  const userName = userRows[0]?.name ?? 'Personal'
  const email = userRows[0]?.email ?? `user-${userId.slice(0, 8)}`

  const base =
    email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 32) || 'workspace'
  let slug = base
  for (let i = 0; i < 100; i++) {
    const collision = await getMigrateDb()
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug))
      .limit(1)
    if (collision.length === 0) break
    slug = `${base}-${i + 1}`
  }

  const tenantId = uuidv7()
  await getMigrateDb().transaction(async tx => {
    await tx.insert(tenantsTable).values({
      id: tenantId,
      name: `${userName}'s Workspace`,
      slug,
      createdBy: userId,
      isPersonal: true
    })
    await tx.insert(tenantMembersTable).values({
      tenantId,
      userId,
      role: 'TENANT_ADMIN'
    })
  })

  return tenantId
}

/**
 * Enrich tenant documents with member summaries (name + email).
 * Used by the tenant switcher to show who is in each workspace.
 */
export async function enrichTenantsWithMembers(
  tenants: TenantDocument[]
): Promise<TenantWithMembers[]> {
  if (tenants.length === 0) return []

  return Promise.all(
    tenants.map(async tenant => {
      const rows = await getMigrateDb()
        .select({
          userId: tenantMembersTable.userId,
          email: usersTable.email,
          name: usersTable.name
        })
        .from(tenantMembersTable)
        .innerJoin(usersTable, eq(tenantMembersTable.userId, usersTable.id))
        .where(eq(tenantMembersTable.tenantId, tenant.id))

      const members: MemberSummary[] = rows.map(r => ({
        userId: r.userId,
        email: r.email ?? null,
        name: r.name ?? null
      }))

      return {
        ...tenant,
        memberCount: members.length,
        members
      }
    })
  )
}
