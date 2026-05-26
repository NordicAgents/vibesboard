import { NextResponse } from 'next/server'
import {
  requireTenantMember,
  requireSuperAdmin
} from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { listTenantMembers } from '@vibesboard/tenants'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/tenants/[id]/users
 * List tenant members
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  // Allow super admins to access any tenant's users (e.g. from admin panel)
  const superAdminAuth = await requireSuperAdmin()
  if (!superAdminAuth.ok) {
    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response
  }

  const users = await listTenantMembers(getMigrateDb(), tenantId)

  return NextResponse.json({ users })
}
