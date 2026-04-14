import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { isFeatureEnabled } from '@/lib/features'
import { getBaseBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/tenants/[id]/branding/reset
 * Reset tenant branding to inherit fully from platform base
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

  // Block for personal workspaces
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  if (tenantDoc.data()?.isPersonal) {
    return NextResponse.json(
      { error: 'Branding is not configurable for personal workspaces' },
      { status: 403 }
    )
  }

  // Enforce feature flag for non-super admins
  if (!isSuperAdminUser) {
    const customBrandingEnabled = await isFeatureEnabled(
      tenantId,
      'CUSTOM_BRANDING'
    )
    if (!customBrandingEnabled) {
      return NextResponse.json(
        { error: 'Custom branding is disabled for this workspace' },
        { status: 403 }
      )
    }
  }

  const baseBranding = await getBaseBranding()

  // Set overrides to empty and update stored values to match base
  const brandingRef = adminDb
    .collection(Collections.branding(tenantId))
    .doc(tenantId)

  await brandingRef.set(
    {
      tenantId,
      primaryColor: baseBranding.primaryColor,
      secondaryColor: baseBranding.secondaryColor,
      logoUrl: baseBranding.logoUrl || null,
      overrides: [],
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  )

  return NextResponse.json({
    branding: baseBranding,
    baseBranding,
    overrides: []
  })
}
