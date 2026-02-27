import 'server-only'
import { NextResponse } from 'next/server'
import { auth, type SessionUser } from './auth'
import { adminDb } from './admin'
import { Collections } from '@/lib/firestore-types'
import type { Role } from '@/lib/permissions'

interface AuthResult {
  user: SessionUser
  tenantId?: string
  role?: Role
}

/**
 * Verify the session and optionally check tenant membership.
 * Returns the user or a 401 response.
 */
export async function requireAuth(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const session = await auth()
  if (!session?.user) {
    return { ok: false, response: new NextResponse('Unauthorized', { status: 401 }) }
  }
  return { ok: true, user: session.user }
}

/**
 * Verify the session and check that the user is a member of the specified tenant.
 */
export async function requireTenantMember(
  tenantId: string
): Promise<
  | { ok: true; user: SessionUser; role: Role }
  | { ok: false; response: NextResponse }
> {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult

  const memberDoc = await adminDb
    .collection(Collections.members(tenantId))
    .doc(authResult.user.id)
    .get()

  if (!memberDoc.exists) {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return {
    ok: true,
    user: authResult.user,
    role: memberDoc.data()?.role as Role
  }
}

/**
 * Verify the session and check that the user is a tenant admin or super admin.
 */
export async function requireTenantAdmin(
  tenantId: string
): Promise<
  | { ok: true; user: SessionUser; role: Role }
  | { ok: false; response: NextResponse }
> {
  const result = await requireTenantMember(tenantId)
  if (!result.ok) return result

  if (result.role !== 'TENANT_ADMIN' && result.role !== 'SUPER_ADMIN') {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return result
}

/**
 * Verify the session and check that the user is a super admin.
 */
export async function requireSuperAdmin(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult

  const userDoc = await adminDb
    .collection(Collections.users)
    .doc(authResult.user.id)
    .get()

  if (!userDoc.exists || !userDoc.data()?.isSuperAdmin) {
    // Fallback: check collection group
    const snapshot = await adminDb
      .collectionGroup('members')
      .where('userId', '==', authResult.user.id)
      .where('role', '==', 'SUPER_ADMIN')
      .limit(1)
      .get()

    if (snapshot.empty) {
      return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
    }
  }

  return { ok: true, user: authResult.user }
}
