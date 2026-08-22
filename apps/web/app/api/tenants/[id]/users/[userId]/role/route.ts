import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { setMemberRole, removeMember } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string; userId: string }> }

export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId, userId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'
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

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
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

  const result = await setMemberRole(getMigrateDb(), tenantId, userId, role)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'User is not a member of this tenant' },
      { status: 404 }
    )
  }
  return NextResponse.json({ success: true, user: { userId, tenantId, role } })
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id: tenantId, userId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'
  if (auth.user.id === userId) {
    return NextResponse.json(
      { error: 'Cannot remove yourself from tenant' },
      { status: 400 }
    )
  }

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
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

  const result = await removeMember(getMigrateDb(), tenantId, userId)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'User is not a member of this tenant' },
      { status: 404 }
    )
  }
  return NextResponse.json({ success: true })
}
