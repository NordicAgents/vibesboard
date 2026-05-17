import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { FieldValue } from 'firebase-admin/firestore'
import { setActiveTenantId } from '@/lib/tenant-context'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    token: string
  }>
}

/**
 * POST /api/invitations/[token]/accept
 * Accept invitation (authenticated user)
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { token } = await params

  // Get invitation by token (doc ID = token)
  const invitationRef = adminDb.collection(Collections.invitations).doc(token)

  const invitationDoc = await invitationRef.get()

  if (!invitationDoc.exists) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  const invitation = invitationDoc.data()!

  // Check if invitation is expired
  const now = new Date()
  const expiresAt = new Date(invitation.expiresAt)

  if (now > expiresAt) {
    return NextResponse.json(
      { error: 'Invitation has expired' },
      { status: 410 }
    )
  }

  // Check if invitation is already accepted
  if (invitation.status === 'accepted') {
    return NextResponse.json(
      { error: 'Invitation has already been accepted' },
      { status: 410 }
    )
  }

  if (invitation.status !== 'pending') {
    return NextResponse.json(
      { error: 'Invitation is no longer valid' },
      { status: 410 }
    )
  }

  const tenantId = invitation.tenantId
  const userId = auth.user.id

  // Check if user is already a member
  const memberDoc = await adminDb
    .collection(Collections.members(tenantId))
    .doc(userId)
    .get()

  if (memberDoc.exists) {
    return NextResponse.json(
      { error: 'You are already a member of this tenant' },
      { status: 409 }
    )
  }

  // Use a batch to add member + update invitation + update user atomically
  const batch = adminDb.batch()

  // Add user to tenant members
  batch.set(adminDb.collection(Collections.members(tenantId)).doc(userId), {
    userId,
    tenantId,
    role: invitation.role,
    createdAt: now.toISOString()
  })

  // Mark invitation as accepted
  batch.update(invitationRef, {
    status: 'accepted',
    acceptedAt: now.toISOString()
  })

  // Add tenantId to user's tenantIds array
  batch.update(adminDb.collection(Collections.users).doc(userId), {
    tenantIds: FieldValue.arrayUnion(tenantId)
  })

  await batch.commit()

  // Set active tenant for the new member
  await setActiveTenantId(tenantId)

  return NextResponse.json({
    success: true,
    tenant_id: tenantId
  })
}
