import 'server-only'
import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth, type SessionUser } from '../auth'
import { withDb } from '@vibesboard/adapter-postgres/client'
import { tenantMembers, users } from '@vibesboard/adapter-postgres/schema'
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
import type { Role } from '@vibesboard/policy/permissions'

export async function requireAuth(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const session = await auth()
  if (!session?.user) {
    return { ok: false, response: new NextResponse('Unauthorized', { status: 401 }) }
  }
  return { ok: true, user: session.user }
}

export async function requireTenantMember(
  tenantId: string,
): Promise<
  { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse }
> {
  const a = await requireAuth()
  if (!a.ok) return a

  const rows = await withTenant(
    { tenantId, userId: a.user.id, isSuperAdmin: false },
    () =>
      withDb((tx) =>
        tx
          .select({ role: tenantMembers.role })
          .from(tenantMembers)
          .where(
            and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, a.user.id)),
          )
          .limit(1),
      ),
  )

  if (rows.length === 0) {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return { ok: true, user: a.user, role: rows[0].role as Role }
}

export async function requireTenantAdmin(
  tenantId: string,
): Promise<
  { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse }
> {
  const result = await requireTenantMember(tenantId)
  if (!result.ok) return result

  if (result.role !== 'TENANT_ADMIN' && result.role !== 'SUPER_ADMIN') {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return result
}

export async function requireSuperAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const a = await requireAuth()
  if (!a.ok) return a

  const rows = await withTenant(
    { tenantId: '', userId: a.user.id, isSuperAdmin: false },
    () =>
      withDb((tx) =>
        tx
          .select({ isSuperAdmin: users.isSuperAdmin })
          .from(users)
          .where(eq(users.id, a.user.id))
          .limit(1),
      ),
  )

  if (rows.length === 0 || !rows[0].isSuperAdmin) {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return { ok: true, user: a.user }
}
