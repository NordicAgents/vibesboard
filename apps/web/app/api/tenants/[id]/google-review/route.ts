import { NextResponse } from 'next/server'
import {
  requireTenantMember,
  requireTenantAdmin
} from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { isFeatureEnabled } from '@vibesboard/policy/features'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/tenants/[id]/google-review
 * Get tenant Google Place ID (any tenant member)
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const data = tenantDoc.data()!
  return NextResponse.json({ googlePlaceId: data.googlePlaceId ?? null })
}

/**
 * PUT /api/tenants/[id]/google-review
 * Update tenant Google Place ID (TENANT_ADMIN or SUPER_ADMIN)
 */
export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

  const body = await req.json()
  const { googlePlaceId } = body

  // Block for personal workspaces
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
      { error: 'Google Review is not configurable for personal workspaces' },
      { status: 403 }
    )
  }

  // Enforce feature flag for non-super admins
  if (!isSuperAdminUser) {
    const googleReviewEnabled = await isFeatureEnabled(
      tenantId,
      'GOOGLE_REVIEW'
    )
    if (!googleReviewEnabled) {
      return NextResponse.json(
        { error: 'Google Review is disabled for this workspace' },
        { status: 403 }
      )
    }
  }

  // Validate Place ID format (basic check)
  if (googlePlaceId && typeof googlePlaceId !== 'string') {
    return NextResponse.json(
      { error: 'Invalid Google Place ID format' },
      { status: 400 }
    )
  }

  await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .update({
      googlePlaceId: googlePlaceId || null,
      updatedAt: new Date().toISOString()
    })

  return NextResponse.json({ googlePlaceId: googlePlaceId || null })
}
