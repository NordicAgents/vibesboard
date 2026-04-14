import { NextResponse } from 'next/server'
import { requireAuth, requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { maskEmail } from '@/lib/email'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    token: string
  }>
}

/**
 * GET /api/invitations/[token]
 * Get invitation details (public)
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { token } = await params

  const invitationDoc = await adminDb
    .collection(Collections.invitations)
    .doc(token)
    .get()

  if (!invitationDoc.exists) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  const invitation = invitationDoc.data()!
  const now = new Date()
  const expiresAt = new Date(invitation.expiresAt)

  // If marked expired but hasn't actually expired yet, update expiresAt to now
  if (invitation.status === 'expired' && now < expiresAt) {
    const nowIso = now.toISOString()
    await invitationDoc.ref.update({ expiresAt: nowIso })
    invitation.expiresAt = nowIso
  }

  // If past expiry and still pending, mark as expired
  if (now > expiresAt && invitation.status === 'pending') {
    await invitationDoc.ref.update({ status: 'expired' })
    invitation.status = 'expired'
  }

  // Get tenant name
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(invitation.tenantId)
    .get()

  const tenantName = tenantDoc.exists
    ? tenantDoc.data()?.name
    : 'Unknown tenant'

  // Get inviter info
  const inviterDoc = await adminDb
    .collection(Collections.users)
    .doc(invitation.createdBy)
    .get()

  const inviterEmail = inviterDoc.exists ? inviterDoc.data()?.email : 'Unknown'

  const responseInvitation = {
    id: invitationDoc.id,
    tenant_id: invitation.tenantId,
    tenant_name: tenantName,
    email: maskEmail(invitation.email),
    role: invitation.role,
    status: invitation.status,
    created_at: invitation.createdAt,
    expires_at: invitation.expiresAt,
    accepted_at: invitation.acceptedAt ?? null,
    invited_by_email: inviterEmail
  }

  return NextResponse.json({ invitation: responseInvitation })
}

/**
 * DELETE /api/invitations/[token]
 * Cancel invitation (TENANT_ADMIN or SUPER_ADMIN)
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Note: this route param is `[token]` for historical reasons.
  // For DELETE requests we treat it as an invitation ID.
  const { token: invitationId } = await params

  const invitationDoc = await adminDb
    .collection(Collections.invitations)
    .doc(invitationId)
    .get()

  if (!invitationDoc.exists) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  const invitation = invitationDoc.data()!

  // Check permissions: must be admin of the invitation's tenant
  const adminCheck = await requireTenantAdmin(invitation.tenantId)
  if (!adminCheck.ok) return adminCheck.response

  if (invitation.status === 'accepted') {
    return NextResponse.json(
      { error: 'Cannot cancel an accepted invitation' },
      { status: 400 }
    )
  }

  await invitationDoc.ref.update({
    status: 'expired',
    expiresAt: new Date().toISOString()
  })

  return new NextResponse(null, { status: 204 })
}
