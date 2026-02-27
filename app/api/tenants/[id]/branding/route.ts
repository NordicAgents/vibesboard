import { NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { isFeatureEnabled } from '@/lib/features'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/tenants/[id]/branding
 * Get tenant branding (any tenant member)
 */
export async function GET(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response

    const brandingDoc = await adminDb
        .collection(Collections.branding(tenantId))
        .doc(tenantId)
        .get()

    const branding = brandingDoc.exists ? brandingDoc.data() : null

    return NextResponse.json({ branding })
}

/**
 * PUT /api/tenants/[id]/branding
 * Update tenant branding (TENANT_ADMIN or SUPER_ADMIN)
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
    if (!auth.ok) return auth.response

    const isSuperAdminUser = auth.role === 'SUPER_ADMIN'

    const body = await req.json()
    const { logo_url, primary_color, secondary_color } = body

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

    // Validate logo URL if provided
    if (logo_url && logo_url !== '' && !validateUrl(logo_url)) {
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

    // Use set with merge to create or update
    const brandingRef = adminDb
        .collection(Collections.branding(tenantId))
        .doc(tenantId)

    await brandingRef.set(updates, { merge: true })

    const updatedDoc = await brandingRef.get()
    return NextResponse.json({ branding: updatedDoc.data() })
}

/**
 * PATCH /api/tenants/[id]/branding
 * Alias for PUT — update tenant branding
 */
export { PUT as PATCH }
