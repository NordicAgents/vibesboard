import { after, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { createInvitation, listInvitations } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { validateEmail } from '@/lib/validations'
import { randomBytes } from 'crypto'
import { sendInvitationEmail } from '@/lib/email'

export const runtime = 'nodejs'
type RouteParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const tenant = await getTenantById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.isPersonal) return NextResponse.json({ invitations: [] })
  if (auth.role !== 'SUPER_ADMIN') {
    if (!(await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')))
      return NextResponse.json({ error: 'Team collaboration is disabled for this workspace' }, { status: 403 })
  }

  const rows = await listInvitations(getMigrateDb(), tenantId)
  return NextResponse.json({
    invitations: rows.map((r) => ({
      id: r.id, email: r.email, role: r.role, status: r.status,
      created_at: r.createdAt, expires_at: r.expiresAt,
    })),
  })
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { email, role } = body
  if (!email || !validateEmail(email)) return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) return NextResponse.json({ error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' }, { status: 400 })

  const tenant = await getTenantById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.isPersonal) return NextResponse.json({ error: 'Personal workspaces cannot invite members' }, { status: 403 })
  if (auth.role !== 'SUPER_ADMIN') {
    if (!(await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')))
      return NextResponse.json({ error: 'Team collaboration is disabled for this workspace' }, { status: 403 })
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  const result = await createInvitation(getMigrateDb(), { tenantId, email, role, token, createdBy: auth.user.id, expiresAt })
  if (!result.ok) {
    const msg = result.code === 'ALREADY_MEMBER' ? 'User is already a member of this tenant' : 'Invitation already sent to this email'
    return NextResponse.json({ error: msg }, { status: 409 })
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))?.split(',')[0]?.trim()
  const origin = forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const inviteUrl = `${origin}/invite/${token}`

  after(
    sendInvitationEmail({
      to: result.invitation.email,
      inviteUrl,
      tenantName: tenant.name || 'your team',
      inviterName: auth.user.name || auth.user.email || 'A team member',
      role,
    }),
  )

  return NextResponse.json({ invitation: { ...result.invitation, tenantId, token }, inviteUrl }, { status: 201 })
}
