import { NextResponse } from 'next/server'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { toggleFeature, getTenantFeatures } from '@vibesboard/policy/features'
import { isSuperAdmin, isTenantAdmin } from '@vibesboard/policy/permissions'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/tenants/[id]/features
 * List features for a tenant
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const features = await getTenantFeatures(tenantId)

  return NextResponse.json({ features })
}

/**
 * PUT /api/tenants/[id]/features
 * Toggle features for a tenant (tenant admin or super admin)
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const authResult = await requireAuth()
  if (!authResult.ok) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Allow super admins (any tenant, even if not a member) or tenant admins (own tenant)
  const userId = authResult.user.id
  const isSuperAdminUser = await isSuperAdmin(userId)
  const hasAccess = isSuperAdminUser || (await isTenantAdmin(userId, tenantId))

  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Admin access required to toggle features' },
      { status: 403 }
    )
  }

  // Fetch tenant and block feature changes for personal workspaces
  // (super admins can still override)
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenantData = tenantDoc.data()!
  if (tenantData.isPersonal && !isSuperAdminUser) {
    return NextResponse.json(
      { error: 'Features cannot be changed for personal workspaces' },
      { status: 403 }
    )
  }

  const body = await req.json()
  const { feature_flag_id, is_enabled } = body

  if (!feature_flag_id || typeof is_enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Invalid request. Provide feature_flag_id and is_enabled' },
      { status: 400 }
    )
  }

  const result = await toggleFeature(tenantId, feature_flag_id, is_enabled)

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Failed to toggle feature' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
