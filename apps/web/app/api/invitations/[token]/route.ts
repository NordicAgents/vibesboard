import { NextResponse } from 'next/server'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getInvitationByToken, getInvitationTenant, cancelInvitation } from '@vibesboard/tenants'
import { maskEmail } from '@/lib/email'

export const runtime = 'nodejs'
type RouteParams = { params: Promise<{ token: string }> }

export async function GET(req: Request, { params }: RouteParams) {
  const { token } = await params
  const preview = await getInvitationByToken(getMigrateDb(), token)
  if (!preview) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  return NextResponse.json({ invitation: { ...preview, email: maskEmail(preview.email) } })
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const { token: invitationId } = await params
  const db = getMigrateDb()

  const found = await getInvitationTenant(db, invitationId)
  if (!found) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  const adminCheck = await requireTenantAdmin(found.tenantId)
  if (!adminCheck.ok) return adminCheck.response

  const result = await cancelInvitation(db, invitationId)
  if (!result.ok) {
    if (result.code === 'ALREADY_ACCEPTED') return NextResponse.json({ error: 'Cannot cancel an accepted invitation' }, { status: 400 })
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }
  return new NextResponse(null, { status: 204 })
}
