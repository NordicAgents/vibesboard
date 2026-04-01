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

function parseBrandingBody(body: Record<string, any>) {
    return {
        logoUrl: body.logo_url ?? body.logoUrl,
        primaryColor: body.primary_color ?? body.primaryColor,
        secondaryColor: body.secondary_color ?? body.secondaryColor,
    }
}

function validateColors(primaryColor: string | undefined, secondaryColor: string | undefined): NextResponse | null {
    if (!primaryColor && !secondaryColor) return null
    if (validateBrandingColors(primaryColor || '#000000', secondaryColor || '#ffffff')) return null
    return NextResponse.json(
        { error: 'Invalid color format. Use hex colors (e.g., #000000)' },
        { status: 400 }
    )
}

function validateLogoUrl(logoUrl: string | undefined): NextResponse | null {
    if (!logoUrl || logoUrl === '') return null
    if (logoUrl.startsWith('/api/tenants/')) return null
    if (validateUrl(logoUrl)) return null
    return NextResponse.json(
        { error: 'Invalid logo URL format' },
        { status: 400 }
    )
}

function buildBrandingUpdates(
    fields: { logoUrl: any; primaryColor: any; secondaryColor: any },
    tenantId: string
): Record<string, any> {
    const updates: Record<string, any> = { tenantId, updatedAt: new Date().toISOString() }
    if (fields.logoUrl !== undefined) updates.logoUrl = fields.logoUrl || null
    if (fields.primaryColor !== undefined) updates.primaryColor = fields.primaryColor
    if (fields.secondaryColor !== undefined) updates.secondaryColor = fields.secondaryColor
    return updates
}

function isFieldOverridden(effective: any, base: any): boolean {
    return effective !== undefined && effective !== base
}

function computeOverrides(
    updates: Record<string, any>,
    existing: TenantBrandingDocument | null,
    baseBranding: Record<string, any>
): BrandingField[] {
    const fields: Array<{ key: BrandingField; effective: any; base: any }> = [
        { key: 'primaryColor', effective: updates.primaryColor ?? existing?.primaryColor, base: baseBranding.primaryColor },
        { key: 'secondaryColor', effective: updates.secondaryColor ?? existing?.secondaryColor, base: baseBranding.secondaryColor },
        { key: 'logoUrl', effective: updates.logoUrl ?? existing?.logoUrl, base: baseBranding.logoUrl || null },
    ]
    return fields.filter(f => isFieldOverridden(f.effective, f.base)).map(f => f.key)
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

    const body = await req.json()
    const fields = parseBrandingBody(body)

    const colorError = validateColors(fields.primaryColor, fields.secondaryColor)
    if (colorError) return colorError

    const logoError = validateLogoUrl(fields.logoUrl)
    if (logoError) return logoError

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

    if (auth.role !== 'SUPER_ADMIN') {
        const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
        if (!customBrandingEnabled) {
            return NextResponse.json(
                { error: 'Custom branding is disabled for this workspace' },
                { status: 403 }
            )
        }
    }

    const updates = buildBrandingUpdates(fields, tenantId)

    if (Object.keys(updates).length === 2) {
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 }
        )
    }

    const brandingRef = adminDb
        .collection(Collections.branding(tenantId))
        .doc(tenantId)

    const [existingDoc, baseBranding] = await Promise.all([
        brandingRef.get(),
        getBaseBranding()
    ])
    const existing = existingDoc.exists ? (existingDoc.data() as TenantBrandingDocument) : null

    updates.overrides = computeOverrides(updates, existing, baseBranding)

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
