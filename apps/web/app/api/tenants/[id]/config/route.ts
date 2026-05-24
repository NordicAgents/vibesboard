import { NextResponse } from 'next/server'
import { requireTenantMember, requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantBranding } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { getTenantFeatures } from '@vibesboard/policy/features'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/** GET /api/tenants/[id]/config — tenant config (features + branding). */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  const superAdminAuth = await requireSuperAdmin()
  if (!superAdminAuth.ok) {
    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response
  }

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const [brandingRow, baseBranding] = await Promise.all([
    getTenantBranding(getMigrateDb(), tenantId),
    getBaseBranding(),
  ])

  const effectiveBranding = resolveEffectiveBranding(
    brandingRow
      ? ({
          primaryColor: brandingRow.primaryColor,
          secondaryColor: brandingRow.secondaryColor,
          logoUrl: brandingRow.logoUrl ?? undefined,
          overrides: brandingRow.overrides ?? undefined,
        } as Parameters<typeof resolveEffectiveBranding>[0])
      : null,
    baseBranding,
  )

  const features = await getTenantFeatures(tenantId)

  return NextResponse.json({
    tenant: { ...tenant, branding: effectiveBranding, features },
    branding: effectiveBranding,
    baseBranding,
    overrides: brandingRow?.overrides ?? null,
    features,
  })
}
