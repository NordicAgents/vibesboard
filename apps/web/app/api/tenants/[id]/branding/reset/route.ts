import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { upsertTenantBranding } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
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

  // Block for personal workspaces
  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
    return NextResponse.json(
      { error: 'Branding is not configurable for personal workspaces' },
      { status: 403 }
    )
  }

  // Enforce feature flag for non-super admins
  if (auth.role !== 'SUPER_ADMIN') {
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

  // Empty overrides + base values = fully inherited from platform base.
  await upsertTenantBranding(getMigrateDb(), tenantId, {
    primaryColor: baseBranding.primaryColor,
    secondaryColor: baseBranding.secondaryColor,
    logoUrl: baseBranding.logoUrl || null,
    overrides: []
  })

  return NextResponse.json({
    branding: baseBranding,
    baseBranding,
    overrides: []
  })
}
