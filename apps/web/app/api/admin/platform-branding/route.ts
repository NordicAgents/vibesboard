import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { invalidateBaseBrandingCache } from '@/lib/base-branding'

export const runtime = 'nodejs'

/**
 * GET /api/admin/platform-branding
 * Get platform base branding (SUPER_ADMIN only)
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const doc = await adminDb
    .collection(Collections.platformConfig)
    .doc('branding')
    .get()

  return NextResponse.json({
    branding: doc.exists ? doc.data() : null
  })
}

/**
 * PUT /api/admin/platform-branding
 * Update platform base branding (SUPER_ADMIN only)
 */
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
      { status: 400 }
    )
  }

  if (!validateBrandingColors(primaryColor, secondaryColor)) {
    return NextResponse.json(
      { error: 'Invalid color format. Use hex colors (e.g., #000000)' },
      { status: 400 }
    )
  }

  const isRelativeLogoPath = logoUrl && logoUrl.startsWith('/api/tenants/')
  if (
    logoUrl &&
    logoUrl !== '' &&
    !isRelativeLogoPath &&
    !validateUrl(logoUrl)
  ) {
    return NextResponse.json(
      { error: 'Invalid logo URL format' },
      { status: 400 }
    )
  }

  const data = {
    primaryColor,
    secondaryColor,
    logoUrl: logoUrl || null,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.user.id
  }

  await adminDb
    .collection(Collections.platformConfig)
    .doc('branding')
    .set(data, { merge: true })

  invalidateBaseBrandingCache()

  return NextResponse.json({ branding: data })
}
