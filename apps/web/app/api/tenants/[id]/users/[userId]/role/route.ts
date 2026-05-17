import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { isFeatureEnabled } from '@vibesboard/policy/features'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
    userId: string
  }>
}

/**
 * PUT /api/tenants/[id]/users/[userId]/role
 * Update member role (TENANT_ADMIN or SUPER_ADMIN)
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId, userId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

  // Prevent users from changing their own role (unless super admin)
  if (auth.user.id === userId && !isSuperAdminUser) {
    return NextResponse.json(
      { error: 'Cannot change your own role' },
      { status: 400 }
    )
  }

  const body = await req.json()
  const { role } = body

  if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) {
    return NextResponse.json(
      { error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' },
      { status: 400 }
    )
  }

  // Block role changes in personal workspaces
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenantData = tenantDoc.data()!
  if (tenantData.isPersonal) {
    return NextResponse.json(
      { error: 'Personal workspaces cannot manage team roles' },
      { status: 403 }
    )
  }

  if (!isSuperAdminUser) {
    const teamEnabled = await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')
    if (!teamEnabled) {
      return NextResponse.json(
        { error: 'Team collaboration is disabled for this workspace' },
        { status: 403 }
      )
    }
  }

  const memberRef = adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)

  const memberDoc = await memberRef.get()
  if (!memberDoc.exists) {
    return NextResponse.json(
      { error: 'User is not a member of this tenant' },
      { status: 404 }
    )
  }

  await memberRef.update({ role })

  const updatedDoc = await memberRef.get()
  return NextResponse.json({
    success: true,
    user: { userId, tenantId, ...updatedDoc.data() }
  })
}

/**
 * DELETE /api/tenants/[id]/users/[userId]/role
 * Remove user from tenant
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const { id: tenantId, userId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

  // Prevent users from removing themselves
  if (auth.user.id === userId) {
    return NextResponse.json(
      { error: 'Cannot remove yourself from tenant' },
      { status: 400 }
    )
  }

  // Block removals in personal workspaces
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenantData = tenantDoc.data()!
  if (tenantData.isPersonal) {
    return NextResponse.json(
      { error: 'Personal workspaces cannot manage team membership' },
      { status: 403 }
    )
  }

  if (!isSuperAdminUser) {
    const teamEnabled = await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')
    if (!teamEnabled) {
      return NextResponse.json(
        { error: 'Team collaboration is disabled for this workspace' },
        { status: 403 }
      )
    }
  }

  const memberRef = adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)

  const memberDoc = await memberRef.get()
  if (!memberDoc.exists) {
    return NextResponse.json(
      { error: 'User is not a member of this tenant' },
      { status: 404 }
    )
  }

  await memberRef.delete()

  // Also remove tenantId from user's tenantIds array
  const { FieldValue } = await import('firebase-admin/firestore')
  await adminDb
    .collection(Collections.users)
    .doc(userId)
    .update({
      tenantIds: FieldValue.arrayRemove(tenantId)
    })

  return NextResponse.json({ success: true })
}
