import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { FieldValue } from 'firebase-admin/firestore'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/admin/tenants/[id]
 * Get single tenant details (SUPER_ADMIN only)
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params

  const tenantDoc = await adminDb.collection(Collections.tenants).doc(id).get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = { id: tenantDoc.id, ...tenantDoc.data() }

  // Get branding
  const brandingDoc = await adminDb
    .collection(Collections.branding(id))
    .doc(id)
    .get()

  const branding = brandingDoc.exists ? brandingDoc.data() : null

  // Get member count
  const membersCount = await adminDb
    .collection(Collections.members(id))
    .count()
    .get()

  return NextResponse.json({
    tenant,
    branding,
    user_count: membersCount.data().count
  })
}

/**
 * PUT /api/admin/tenants/[id]
 * Update tenant (SUPER_ADMIN only)
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = await req.json()
  const { name, slug, status } = body

  // Build update object
  const updates: Record<string, any> = {
    updatedAt: new Date().toISOString()
  }
  if (name !== undefined) updates.name = name
  if (slug !== undefined) updates.slug = slug
  if (
    status !== undefined &&
    ['active', 'trial', 'suspended'].includes(status)
  ) {
    updates.status = status
  }

  if (Object.keys(updates).length === 1) {
    // Only updatedAt, no real fields
    return NextResponse.json(
      { error: 'No valid fields to update' },
      { status: 400 }
    )
  }

  const tenantRef = adminDb.collection(Collections.tenants).doc(id)
  const tenantDoc = await tenantRef.get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  await tenantRef.update(updates)

  const updatedDoc = await tenantRef.get()
  const tenant = { id: updatedDoc.id, ...updatedDoc.data() }

  return NextResponse.json({ tenant })
}

/**
 * DELETE /api/admin/tenants/[id]
 * Hard delete tenant and ALL related data (SUPER_ADMIN only).
 *
 * Cascade:
 *  1. Remove tenantId from every member's user.tenantIds array
 *  2. Delete all invitations for this tenant
 *  3. Delete the slug reservation
 *  4. recursiveDelete the tenant doc + every subcollection
 *     (members, agents, conversations, files, chunks, hooks, branding, etc.)
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id: tenantId } = await params

  const tenantRef = adminDb.collection(Collections.tenants).doc(tenantId)
  const tenantDoc = await tenantRef.get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenantData = tenantDoc.data()!
  const slug = tenantData.slug as string | undefined

  // 1. Remove tenantId from each member's user doc
  const membersSnap = await adminDb
    .collection(Collections.members(tenantId))
    .get()

  const userUpdateBatch = adminDb.batch()
  for (const memberDoc of membersSnap.docs) {
    const userId = memberDoc.id
    userUpdateBatch.update(adminDb.collection(Collections.users).doc(userId), {
      tenantIds: FieldValue.arrayRemove(tenantId)
    })
  }
  await userUpdateBatch.commit()

  // 2. Delete all invitations referencing this tenant
  const invitationsSnap = await adminDb
    .collection(Collections.invitations)
    .where('tenantId', '==', tenantId)
    .get()

  if (!invitationsSnap.empty) {
    const invBatch = adminDb.batch()
    for (const invDoc of invitationsSnap.docs) {
      invBatch.delete(invDoc.ref)
    }
    await invBatch.commit()
  }

  // 3. Delete slug reservation
  if (slug) {
    await adminDb.collection(Collections.tenantSlugs).doc(slug).delete()
  }

  // 4. Recursively delete tenant doc + all subcollections
  //    (members, branding, feature_toggles, agents/*/conversations,
  //     agents/*/files, agents/*/file_chunks, agents/*/hooks/*/jobs, etc.)
  await adminDb.recursiveDelete(tenantRef)

  return NextResponse.json({ success: true })
}
