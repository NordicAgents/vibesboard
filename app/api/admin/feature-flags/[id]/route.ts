import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

/**
 * GET /api/admin/feature-flags/[id]
 * Get single feature flag (SUPER_ADMIN only)
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const doc = await adminDb
        .collection(Collections.featureFlags)
        .doc(id)
        .get()

    if (!doc.exists) {
        return NextResponse.json(
            { error: 'Feature flag not found' },
            { status: 404 }
        )
    }

    return NextResponse.json({ flag: { id: doc.id, ...doc.data() } })
}

/**
 * PUT /api/admin/feature-flags/[id]
 * Update feature flag (SUPER_ADMIN only)
 */
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json()
    const { name, description, default_value } = body

    const docRef = adminDb.collection(Collections.featureFlags).doc(id)
    const doc = await docRef.get()

    if (!doc.exists) {
        return NextResponse.json(
            { error: 'Feature flag not found' },
            { status: 404 }
        )
    }

    const updates: Record<string, any> = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (default_value !== undefined) updates.defaultValue = default_value

    if (Object.keys(updates).length === 0) {
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 }
        )
    }

    await docRef.update(updates)

    const updatedDoc = await docRef.get()
    return NextResponse.json({ flag: { id: updatedDoc.id, ...updatedDoc.data() } })
}

/**
 * DELETE /api/admin/feature-flags/[id]
 * Delete feature flag (SUPER_ADMIN only)
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.response

    const docRef = adminDb.collection(Collections.featureFlags).doc(id)
    const doc = await docRef.get()

    if (!doc.exists) {
        return NextResponse.json(
            { error: 'Feature flag not found' },
            { status: 404 }
        )
    }

    await docRef.delete()

    return new NextResponse(null, { status: 204 })
}
