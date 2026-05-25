import { NextResponse } from 'next/server'
import {
  requireTenantMember,
  requireTenantAdmin
} from '@/lib/auth/route-handler'
import {
  getTenantGooglePlaceId,
  setTenantGooglePlaceId,
  getTenantIsPersonal
} from '@vibesboard/tenants'
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

  // getTenantIsPersonal returns null when the tenant row is missing.
  const isPersonal = await getTenantIsPersonal(tenantId)
  if (isPersonal === null) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const googlePlaceId = await getTenantGooglePlaceId(tenantId)
  return NextResponse.json({ googlePlaceId })
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

  // Block for personal workspaces (and 404 when the tenant is missing).
  const isPersonal = await getTenantIsPersonal(tenantId)
  if (isPersonal === null) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (isPersonal) {
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

  await setTenantGooglePlaceId(tenantId, googlePlaceId || null)

  return NextResponse.json({ googlePlaceId: googlePlaceId || null })
}
