import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/admin/tenants/[id]
 * Get single tenant details (SUPER_ADMIN only)
 */
export async function GET(req: Request, { params }: RouteParams) {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const { id } = await params

    const tenantDoc = await adminDb
        .collection(Collections.tenants)
        .doc(id)
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
        .collection(Collections.branding(id))
        .doc(id)
        .get()

    const branding = brandingDoc.exists ? brandingDoc.data() : null

    // Get member count
    const membersCount = await adminDb
        .collection(Collections.members(id))
        .count()
        .get()

    return NextResponse.json({
        tenant,
        branding,
        user_count: membersCount.data().count
    })
}

/**
 * PUT /api/admin/tenants/[id]
 * Update tenant (SUPER_ADMIN only)
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const { id } = await params
    const body = await req.json()
    const { name, slug, status } = body

    // Build update object
    const updates: Record<string, any> = {
        updatedAt: new Date().toISOString()
    }
    if (name !== undefined) updates.name = name
    if (slug !== undefined) updates.slug = slug
    if (status !== undefined && ['active', 'trial', 'suspended'].includes(status)) {
        updates.status = status
    }

    if (Object.keys(updates).length === 1) {
        // Only updatedAt, no real fields
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 }
        )
    }

    const tenantRef = adminDb.collection(Collections.tenants).doc(id)
    const tenantDoc = await tenantRef.get()

    if (!tenantDoc.exists) {
        return NextResponse.json(
            { error: 'Tenant not found' },
            { status: 404 }
        )
    }

    await tenantRef.update(updates)

    const updatedDoc = await tenantRef.get()
    const tenant = { id: updatedDoc.id, ...updatedDoc.data() }

    return NextResponse.json({ tenant })
}

/**
 * DELETE /api/admin/tenants/[id]
 * Soft delete tenant (SUPER_ADMIN only) — marks as suspended
 */
export async function DELETE(req: Request, { params }: RouteParams) {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const { id } = await params

    const tenantRef = adminDb.collection(Collections.tenants).doc(id)
    const tenantDoc = await tenantRef.get()

    if (!tenantDoc.exists) {
        return NextResponse.json(
            { error: 'Tenant not found' },
            { status: 404 }
        )
    }

    await tenantRef.update({
        status: 'suspended',
        updatedAt: new Date().toISOString()
    })

    const updatedDoc = await tenantRef.get()
    const tenant = { id: updatedDoc.id, ...updatedDoc.data() }

    return NextResponse.json({ success: true, tenant })
}
