import { and, count, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenants, tenantMembers, users } from '@vibesboard/adapter-postgres/schema'
import { isUniqueViolation } from './db-utils.ts'

type Db = PostgresJsDatabase<typeof schema>

export type TenantStatus = 'active' | 'pending' | 'trial' | 'suspended'

export interface AdminTenant {
  id: string
  name: string
  slug: string
  status: string
  createdBy: string | null
  isPersonal: boolean
  createdAt: string
  updatedAt: string
}

function rowToAdminTenant(row: typeof tenants.$inferSelect): AdminTenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdBy: row.createdBy,
    isPersonal: row.isPersonal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type CreateTenantResult =
  | { ok: true; tenant: AdminTenant }
  | { ok: false; code: 'SLUG_TAKEN' }

export async function createTenantAsAdmin(
  db: Db,
  input: { name: string; slug: string; createdBy: string },
): Promise<CreateTenantResult> {
  const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug)).limit(1)
  if (existing.length > 0) return { ok: false, code: 'SLUG_TAKEN' }

  const tenantId = uuidv7()
  try {
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(tenants)
        .values({ id: tenantId, name: input.name, slug: input.slug, status: 'active', createdBy: input.createdBy, isPersonal: false })
        .returning()
      await tx.insert(tenantMembers).values({ tenantId, userId: input.createdBy, role: 'TENANT_ADMIN' })
      return inserted[0]
    })
    return { ok: true, tenant: rowToAdminTenant(row) }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: 'SLUG_TAKEN' }
    throw err
  }
}

export interface AdminTenantListItem extends AdminTenant {
  user_count: number
  creator_email: string | null
  creator_name: string | null
}

export async function listTenants(
  db: Db,
  opts: { page: number; limit: number; status?: string },
): Promise<{ tenants: AdminTenantListItem[]; total: number }> {
  const validStatus =
    opts.status && ['active', 'trial', 'suspended'].includes(opts.status) ? opts.status : undefined
  const where = validStatus ? eq(tenants.status, validStatus as TenantStatus) : undefined

  const totalRows = await db.select({ n: count() }).from(tenants).where(where)
  const total = Number(totalRows[0]?.n ?? 0)

  const memberCount = sql<number>`(select count(*) from ${tenantMembers} tm where tm.tenant_id = ${tenants.id})`
  const rows = await db
    .select({
      t: tenants,
      user_count: memberCount,
      creator_email: users.email,
      creator_name: users.name,
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.createdBy))
    .where(where)
    .orderBy(desc(tenants.createdAt))
    .limit(opts.limit)
    .offset((opts.page - 1) * opts.limit)

  return {
    total,
    tenants: rows.map((r) => ({
      ...rowToAdminTenant(r.t),
      user_count: Number(r.user_count),
      creator_email: r.creator_email ?? null,
      creator_name: r.creator_name ?? null,
    })),
  }
}

export async function getTenantDetail(
  db: Db,
  id: string,
): Promise<{ tenant: AdminTenant; user_count: number } | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
  if (rows.length === 0) return null
  const c = await db.select({ n: count() }).from(tenantMembers).where(eq(tenantMembers.tenantId, id))
  return { tenant: rowToAdminTenant(rows[0]), user_count: Number(c[0]?.n ?? 0) }
}

export async function updateTenant(
  db: Db,
  id: string,
  fields: { name?: string; slug?: string; status?: string },
): Promise<AdminTenant | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (fields.name !== undefined) set.name = fields.name
  if (fields.slug !== undefined) set.slug = fields.slug
  if (fields.status !== undefined && ['active', 'trial', 'suspended'].includes(fields.status)) {
    set.status = fields.status
  }
  const updated = await db.update(tenants).set(set).where(eq(tenants.id, id)).returning()
  if (updated.length === 0) return null
  return rowToAdminTenant(updated[0])
}

export async function deleteTenant(db: Db, id: string): Promise<boolean> {
  const deleted = await db.delete(tenants).where(eq(tenants.id, id)).returning({ id: tenants.id })
  return deleted.length > 0
}

export type MemberMutationResult = { ok: true } | { ok: false; code: 'NOT_MEMBER' }

export async function setMemberRole(
  db: Db,
  tenantId: string,
  userId: string,
  role: 'TENANT_ADMIN' | 'MEMBER',
): Promise<MemberMutationResult> {
  const updated = await db
    .update(tenantMembers)
    .set({ role })
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .returning({ userId: tenantMembers.userId })
  return updated.length > 0 ? { ok: true } : { ok: false, code: 'NOT_MEMBER' }
}

export async function removeMember(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<MemberMutationResult> {
  const deleted = await db
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .returning({ userId: tenantMembers.userId })
  return deleted.length > 0 ? { ok: true } : { ok: false, code: 'NOT_MEMBER' }
}
