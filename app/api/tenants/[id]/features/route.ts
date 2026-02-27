import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { toggleFeature, getTenantFeatures } from '@/lib/features'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/tenants/[id]/features
 * List features for a tenant
 */
export async function GET(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
    if (!auth.ok) return auth.response

    const features = await getTenantFeatures(tenantId)

    return NextResponse.json({ features })
}

/**
 * PUT /api/tenants/[id]/features
 * Toggle features for a tenant (SUPER_ADMIN only)
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantAdmin(tenantId)
    if (!auth.ok) return auth.response

    const isSuperAdminUser = auth.role === 'SUPER_ADMIN'
    if (!isSuperAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    // Fetch tenant and block feature changes for personal workspaces
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
            { error: 'Features cannot be changed for personal workspaces' },
            { status: 403 }
        )
    }

    const body = await req.json()
    const { feature_flag_id, is_enabled } = body

    if (!feature_flag_id || typeof is_enabled !== 'boolean') {
        return NextResponse.json(
            { error: 'Invalid request. Provide feature_flag_id and is_enabled' },
            { status: 400 }
        )
    }

    const result = await toggleFeature(tenantId, feature_flag_id, is_enabled)

    if (!result.success) {
        return NextResponse.json(
            { error: result.error || 'Failed to toggle feature' },
            { status: 500 }
        )
    }

    return NextResponse.json({ success: true })
}
