import { NextResponse } from 'next/server'
import {
  requireTenantMember,
  requireSuperAdmin
} from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import type { TenantBrandingDocument } from '@vibesboard/contracts'
import { getTenantFeatures } from '@vibesboard/policy/features'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/tenants/[id]/config
 * Get tenant configuration including features and branding
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  // Allow super admins to access any tenant's config (e.g. from admin panel)
  const superAdminAuth = await requireSuperAdmin()
  if (!superAdminAuth.ok) {
    // Fall back to tenant membership check for regular users
    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response
  }

  // Get tenant details
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const tenant = { id: tenantDoc.id, ...tenantDoc.data() }

  // Get branding with base branding inheritance
  const [brandingDoc, baseBranding] = await Promise.all([
    adminDb.collection(Collections.branding(tenantId)).doc(tenantId).get(),
    getBaseBranding()
  ])

  const tenantBranding = brandingDoc.exists
    ? (brandingDoc.data() as TenantBrandingDocument)
    : null

  const effectiveBranding = resolveEffectiveBranding(
    tenantBranding,
    baseBranding
  )

  // Get features
  const features = await getTenantFeatures(tenantId)

  return NextResponse.json({
    tenant: {
      ...tenant,
      branding: effectiveBranding,
      features
    },
    branding: effectiveBranding,
    baseBranding,
    overrides: tenantBranding?.overrides ?? null,
    features
  })
}
