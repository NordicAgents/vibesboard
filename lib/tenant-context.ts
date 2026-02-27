import { cookies } from 'next/headers'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type TenantDocument, type TenantBrandingDocument } from '@/lib/firestore-types'

const ACTIVE_TENANT_COOKIE = 'active_tenant_id'

export async function getActiveTenantId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(ACTIVE_TENANT_COOKIE)?.value || null
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

export async function getActiveTenant(
  userId?: string
): Promise<string | null> {
  let tenantId = await getActiveTenantId()

  if (!tenantId && userId) {
    tenantId = await ensureActiveTenant(userId)
  }

  return tenantId
}

export async function getUserTenants(userId: string): Promise<TenantDocument[]> {
  // Look up the user document to get tenantIds array
  const userDoc = await adminDb.collection(Collections.users).doc(userId).get()
  if (!userDoc.exists) return []

  const tenantIds: string[] = userDoc.data()?.tenantIds ?? []
  if (!tenantIds.length) return []

  // Fetch tenant documents
  const tenantDocs = await Promise.all(
    tenantIds.map(id =>
      adminDb.collection(Collections.tenants).doc(id).get()
    )
  )

  return tenantDocs
    .filter(doc => doc.exists)
    .map(doc => doc.data() as TenantDocument)
}

export async function getTenantById(
  tenantId: string
): Promise<TenantDocument | null> {
  const doc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!doc.exists) return null
  return doc.data() as TenantDocument
}

export async function getActiveTenantBranding(): Promise<TenantBrandingDocument | null> {
  const tenantId = await getActiveTenantId()
  if (!tenantId) return null

  const doc = await adminDb
    .collection(Collections.branding(tenantId))
    .doc(tenantId)
    .get()

  if (!doc.exists) return null
  return doc.data() as TenantBrandingDocument
}

export async function getTenantContext(userId: string) {
  const tenantId = await getActiveTenantId()
  if (!tenantId) return null

  // Get tenant
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) return null
  const tenant = tenantDoc.data() as TenantDocument

  // Get branding
  const brandingDoc = await adminDb
    .collection(Collections.branding(tenantId))
    .doc(tenantId)
    .get()

  const branding = brandingDoc.exists
    ? (brandingDoc.data() as TenantBrandingDocument)
    : null

  // Get user role
  const memberDoc = await adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)
    .get()

  const role = memberDoc.exists ? memberDoc.data()?.role ?? null : null

  return { tenant, branding, role }
}

export async function ensureActiveTenant(
  userId: string
): Promise<string | null> {
  let tenantId = await getActiveTenantId()

  // Check if user has access to current tenant
  if (tenantId) {
    const memberDoc = await adminDb
      .collection(Collections.members(tenantId))
      .doc(userId)
      .get()

    if (memberDoc.exists) {
      return tenantId
    }
  }

  // Get user's tenants and prefer personal workspace
  const tenants = await getUserTenants(userId)
  const personal = tenants.find(t => t.isPersonal)
  const chosen = personal ?? tenants[0]

  if (chosen) {
    return chosen.id
  }

  // As a fallback, create a personal tenant
  try {
    return await ensurePersonalTenant(userId)
  } catch (error) {
    console.error('Failed to ensure personal tenant:', error)
    return null
  }
}

/**
 * Create or fetch the user's personal tenant.
 */
export async function ensurePersonalTenant(userId: string): Promise<string> {
  // Check if user already has a personal tenant
  const userDoc = await adminDb.collection(Collections.users).doc(userId).get()
  const tenantIds: string[] = userDoc.exists
    ? userDoc.data()?.tenantIds ?? []
    : []

  for (const tid of tenantIds) {
    const tenantDoc = await adminDb
      .collection(Collections.tenants)
      .doc(tid)
      .get()
    if (tenantDoc.exists && tenantDoc.data()?.isPersonal) {
      return tid
    }
  }

  // Create a new personal tenant
  const tenantRef = adminDb.collection(Collections.tenants).doc()
  const tenantId = tenantRef.id
  const userName = userDoc.data()?.name ?? 'Personal'
  const slug = `user-${userId.slice(0, 8)}`
  const now = new Date().toISOString()

  const batch = adminDb.batch()

  // Create tenant
  batch.set(tenantRef, {
    id: tenantId,
    name: `${userName}'s Workspace`,
    slug,
    status: 'active',
    createdBy: userId,
    isPersonal: true,
    createdAt: now,
    updatedAt: now
  })

  // Create slug reservation
  batch.set(
    adminDb.collection(Collections.tenantSlugs).doc(slug),
    { tenantId, createdAt: now }
  )

  // Create membership
  batch.set(
    adminDb.collection(Collections.members(tenantId)).doc(userId),
    {
      userId,
      tenantId,
      role: 'TENANT_ADMIN',
      createdAt: now
    }
  )

  // Update user's tenantIds (use set+merge so it works even if onUserCreated
  // Cloud Function hasn't created the user doc yet — race condition)
  const { FieldValue } = await import('firebase-admin/firestore')
  batch.set(adminDb.collection(Collections.users).doc(userId), {
    tenantIds: FieldValue.arrayUnion(tenantId)
  }, { merge: true })

  await batch.commit()

  return tenantId
}
