import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getPlatformBranding, upsertPlatformBranding } from '@vibesboard/tenants'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { invalidateBaseBrandingCache } from '@/lib/base-branding'

export const runtime = 'nodejs'

/** GET /api/admin/platform-branding — SUPER_ADMIN only */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const branding = await getPlatformBranding(getMigrateDb())
  return NextResponse.json({ branding })
}

/** PUT /api/admin/platform-branding — SUPER_ADMIN only */
export async function PUT(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const logoUrl = body.logoUrl ?? body.logo_url
  const primaryColor = body.primaryColor ?? body.primary_color
  const secondaryColor = body.secondaryColor ?? body.secondary_color

  if (!primaryColor || !secondaryColor) {
    return NextResponse.json(
      { error: 'primaryColor and secondaryColor are required' },
      { status: 400 },
    )
  }
  if (!validateBrandingColors(primaryColor, secondaryColor)) {
    return NextResponse.json(
      { error: 'Invalid color format. Use hex colors (e.g., #000000)' },
      { status: 400 },
    )
  }
  const isRelativeLogoPath = logoUrl && logoUrl.startsWith('/api/tenants/')
  if (logoUrl && logoUrl !== '' && !isRelativeLogoPath && !validateUrl(logoUrl)) {
    return NextResponse.json({ error: 'Invalid logo URL format' }, { status: 400 })
  }

  await upsertPlatformBranding(getMigrateDb(), {
    primaryColor,
    secondaryColor,
    logoUrl: logoUrl || null,
    updatedBy: auth.user.id,
  })
  invalidateBaseBrandingCache()

  return NextResponse.json({
    branding: { primaryColor, secondaryColor, logoUrl: logoUrl || null },
  })
}
