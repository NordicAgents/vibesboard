import { NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { TenantBrandingDocument, BrandingField } from '@/lib/firestore-types'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { isFeatureEnabled } from '@/lib/features'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/tenants/[id]/branding
 * Get tenant branding with base branding and inheritance metadata
 */
export async function GET(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response

    const [brandingDoc, baseBranding] = await Promise.all([
        adminDb
            .collection(Collections.branding(tenantId))
            .doc(tenantId)
            .get(),
        getBaseBranding()
    ])

    const tenantBranding = brandingDoc.exists
        ? (brandingDoc.data() as TenantBrandingDocument)
        : null

    const effective = resolveEffectiveBranding(tenantBranding, baseBranding)

    return NextResponse.json({
        branding: effective,
        baseBranding,
        overrides: tenantBranding?.overrides ?? null,
        raw: tenantBranding
    })
}

/**
 * PUT /api/tenants/[id]/branding
 * Update tenant branding (TENANT_ADMIN or SUPER_ADMIN)
 * Tracks which fields differ from base branding in the overrides array
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
    if (!auth.ok) return auth.response

    const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

    const body = await req.json()
    // Accept both camelCase (UI) and snake_case (API consumers)
    const logo_url = body.logo_url ?? body.logoUrl
    const primary_color = body.primary_color ?? body.primaryColor
    const secondary_color = body.secondary_color ?? body.secondaryColor

    // Validate colors if provided
    if ((primary_color || secondary_color) &&
        !validateBrandingColors(
            primary_color || '#000000',
            secondary_color || '#ffffff'
        )) {
        return NextResponse.json(
            { error: 'Invalid color format. Use hex colors (e.g., #000000)' },
            { status: 400 }
        )
    }

    // Validate logo URL if provided (allow relative /api/ paths for uploaded logos)
    const isRelativeLogoPath = logo_url && logo_url.startsWith('/api/tenants/')
    if (logo_url && logo_url !== '' && !isRelativeLogoPath && !validateUrl(logo_url)) {
        return NextResponse.json(
            { error: 'Invalid logo URL format' },
            { status: 400 }
        )
    }

    // Block branding changes for personal workspaces
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
            { error: 'Branding is not configurable for personal workspaces' },
            { status: 403 }
        )
    }

    // Enforce feature flag for non-super admins
    if (!isSuperAdminUser) {
        const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
        if (!customBrandingEnabled) {
            return NextResponse.json(
                { error: 'Custom branding is disabled for this workspace' },
                { status: 403 }
            )
        }
    }

    // Build update object
    const updates: Record<string, any> = {
        tenantId,
        updatedAt: new Date().toISOString()
    }
    if (logo_url !== undefined) updates.logoUrl = logo_url || null
    if (primary_color !== undefined) updates.primaryColor = primary_color
    if (secondary_color !== undefined) updates.secondaryColor = secondary_color

    if (Object.keys(updates).length === 2) {
        // Only tenantId and updatedAt — no real fields
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 }
        )
    }

    // Read existing branding + base branding to compute overrides correctly
    const brandingRef = adminDb
        .collection(Collections.branding(tenantId))
        .doc(tenantId)

    const [existingDoc, baseBranding] = await Promise.all([
        brandingRef.get(),
        getBaseBranding()
    ])
    const existing = existingDoc.exists ? (existingDoc.data() as TenantBrandingDocument) : null

    // Merge request fields with existing stored values for override computation
    const effectivePrimary = updates.primaryColor ?? existing?.primaryColor ?? undefined
    const effectiveSecondary = updates.secondaryColor ?? existing?.secondaryColor ?? undefined
    const effectiveLogo = updates.logoUrl ?? existing?.logoUrl ?? undefined

    const overrides: BrandingField[] = []
    if (effectivePrimary !== undefined && effectivePrimary !== baseBranding.primaryColor) {
        overrides.push('primaryColor')
    }
    if (effectiveSecondary !== undefined && effectiveSecondary !== baseBranding.secondaryColor) {
        overrides.push('secondaryColor')
    }
    if (effectiveLogo !== undefined && effectiveLogo !== (baseBranding.logoUrl || null)) {
        overrides.push('logoUrl')
    }

    updates.overrides = overrides

    // Use set with merge to create or update
    await brandingRef.set(updates, { merge: true })

    const updatedDoc = await brandingRef.get()
    const updatedBranding = updatedDoc.data() as TenantBrandingDocument
    const effective = resolveEffectiveBranding(updatedBranding, baseBranding)

    return NextResponse.json({
        branding: effective,
        baseBranding,
        overrides: updatedBranding.overrides ?? null
    })
}

/**
 * PATCH /api/tenants/[id]/branding
 * Alias for PUT — update tenant branding
 */
export { PUT as PATCH }
