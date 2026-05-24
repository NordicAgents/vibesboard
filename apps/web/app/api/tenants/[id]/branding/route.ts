import { NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  getTenantBranding,
  upsertTenantBranding,
  type BrandingField,
} from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getBaseBranding, resolveEffectiveBranding, type BaseBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

function toResolverInput(
  row: Awaited<ReturnType<typeof getTenantBranding>>,
): Parameters<typeof resolveEffectiveBranding>[0] {
  if (!row) return null
  return {
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    logoUrl: row.logoUrl ?? undefined,
    overrides: row.overrides ?? undefined,
  } as Parameters<typeof resolveEffectiveBranding>[0]
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  const db = getMigrateDb()
  const [row, baseBranding] = await Promise.all([
    getTenantBranding(db, tenantId),
    getBaseBranding(),
  ])
  const effective = resolveEffectiveBranding(toResolverInput(row), baseBranding)

  return NextResponse.json({
    branding: effective,
    baseBranding,
    overrides: row?.overrides ?? null,
    raw: row,
  })
}

function parseBrandingBody(body: Record<string, unknown>) {
  return {
    logoUrl: (body.logo_url ?? body.logoUrl) as string | undefined,
    primaryColor: (body.primary_color ?? body.primaryColor) as string | undefined,
    secondaryColor: (body.secondary_color ?? body.secondaryColor) as string | undefined,
  }
}

function validateColors(
  primaryColor: string | undefined,
  secondaryColor: string | undefined,
): NextResponse | null {
  if (!primaryColor && !secondaryColor) return null
  if (validateBrandingColors(primaryColor || '#000000', secondaryColor || '#ffffff')) return null
  return NextResponse.json({ error: 'Invalid color format. Use hex colors (e.g., #000000)' }, { status: 400 })
}

function validateLogoUrl(logoUrl: string | undefined): NextResponse | null {
  if (!logoUrl || logoUrl === '') return null
  if (logoUrl.startsWith('/api/tenants/')) return null
  if (validateUrl(logoUrl)) return null
  return NextResponse.json({ error: 'Invalid logo URL format' }, { status: 400 })
}

function isFieldOverridden(effective: unknown, base: unknown): boolean {
  return effective !== undefined && effective !== base
}

function computeOverrides(
  next: { logoUrl: string | null; primaryColor: string; secondaryColor: string },
  baseBranding: BaseBranding,
): BrandingField[] {
  const fields: Array<{ key: BrandingField; effective: unknown; base: unknown }> = [
    { key: 'primaryColor', effective: next.primaryColor, base: baseBranding.primaryColor },
    { key: 'secondaryColor', effective: next.secondaryColor, base: baseBranding.secondaryColor },
    { key: 'logoUrl', effective: next.logoUrl ?? undefined, base: baseBranding.logoUrl ?? undefined },
  ]
  return fields.filter((f) => isFieldOverridden(f.effective, f.base)).map((f) => f.key)
}

export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const fields = parseBrandingBody(body)

  const colorError = validateColors(fields.primaryColor, fields.secondaryColor)
  if (colorError) return colorError
  const logoError = validateLogoUrl(fields.logoUrl)
  if (logoError) return logoError

  const db = getMigrateDb()

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
    return NextResponse.json(
      { error: 'Branding is not configurable for personal workspaces' },
      { status: 403 },
    )
  }

  if (auth.role !== 'SUPER_ADMIN') {
    const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
    if (!customBrandingEnabled) {
      return NextResponse.json(
        { error: 'Custom branding is disabled for this workspace' },
        { status: 403 },
      )
    }
  }

  if (
    fields.logoUrl === undefined &&
    fields.primaryColor === undefined &&
    fields.secondaryColor === undefined
  ) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const [existing, baseBranding] = await Promise.all([
    getTenantBranding(db, tenantId),
    getBaseBranding(),
  ])

  const next = {
    logoUrl:
      fields.logoUrl !== undefined ? fields.logoUrl || null : (existing?.logoUrl ?? null),
    primaryColor: fields.primaryColor ?? existing?.primaryColor ?? baseBranding.primaryColor,
    secondaryColor: fields.secondaryColor ?? existing?.secondaryColor ?? baseBranding.secondaryColor,
  }
  const overrides = computeOverrides(next, baseBranding)

  await upsertTenantBranding(db, tenantId, { ...next, overrides })

  const effective = resolveEffectiveBranding(
    {
      primaryColor: next.primaryColor,
      secondaryColor: next.secondaryColor,
      logoUrl: next.logoUrl ?? undefined,
      overrides,
    } as Parameters<typeof resolveEffectiveBranding>[0],
    baseBranding,
  )

  return NextResponse.json({ branding: effective, baseBranding, overrides })
}

export { PUT as PATCH }
