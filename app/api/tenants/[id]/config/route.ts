import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getTenantFeatures } from '@/lib/features'

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

    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response

    // Get tenant details
    const tenantDoc = await adminDb
        .collection(Collections.tenants)
        .doc(tenantId)
        .get()

    if (!tenantDoc.exists) {
        return NextResponse.json(
            { error: 'Tenant not found' },
            { status: 404 }
        )
    }

    const tenant = { id: tenantDoc.id, ...tenantDoc.data() }

    // Get branding
    const brandingDoc = await adminDb
        .collection(Collections.branding(tenantId))
        .doc(tenantId)
        .get()

    const branding = brandingDoc.exists ? brandingDoc.data() : null

    // Get features
    const features = await getTenantFeatures(tenantId)

    return NextResponse.json({
        tenant: {
            ...tenant,
            branding,
            features
        },
        branding,
        features
    })
}
