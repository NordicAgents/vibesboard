import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'

export async function getUserRole(
  userId: string,
  tenantId: string
): Promise<Role | null> {
  const doc = await adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)
    .get()

  if (!doc.exists) return null
  return doc.data()?.role as Role
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  // Check the user document for the isSuperAdmin flag
  const userDoc = await adminDb.collection(Collections.users).doc(userId).get()

  if (userDoc.exists && userDoc.data()?.isSuperAdmin) {
    return true
  }

  // Fallback: check if user has SUPER_ADMIN role in any tenant
  const snapshot = await adminDb
    .collectionGroup('members')
    .where('userId', '==', userId)
    .where('role', '==', 'SUPER_ADMIN')
    .limit(1)
    .get()

  return !snapshot.empty
}

export async function isTenantAdmin(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const doc = await adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)
    .get()

  if (!doc.exists) return false
  const role = doc.data()?.role
  return role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN'
}

export async function canManageTenant(
  userId: string,
  tenantId: string
): Promise<boolean> {
  return isTenantAdmin(userId, tenantId)
}

export async function isMemberOfTenant(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const doc = await adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)
    .get()

  return doc.exists
}

export async function hasTenantAdminAccess(userId: string): Promise<boolean> {
  // Check across all tenants if user has admin access
  const snapshot = await adminDb
    .collectionGroup('members')
    .where('userId', '==', userId)
    .where('role', 'in', ['TENANT_ADMIN', 'SUPER_ADMIN'])
    .limit(1)
    .get()

  return !snapshot.empty
}
