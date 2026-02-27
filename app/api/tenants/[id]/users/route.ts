import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/tenants/[id]/users
 * List tenant members
 */
export async function GET(req: Request, { params }: RouteParams) {
    const { id: tenantId } = await params

    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response

    // Get all members
    const membersSnapshot = await adminDb
        .collection(Collections.members(tenantId))
        .get()

    // Fetch user details for each member
    const users = await Promise.all(
        membersSnapshot.docs.map(async (memberDoc) => {
            const memberData = memberDoc.data()
            const userId = memberDoc.id

            // Get user profile from users collection
            const userDoc = await adminDb
                .collection(Collections.users)
                .doc(userId)
                .get()

            const userData = userDoc.exists ? userDoc.data() : null

            return {
                user_id: userId,
                tenant_id: tenantId,
                role: memberData.role,
                created_at: memberData.createdAt,
                email: userData?.email ?? null,
                name: userData?.name ?? null,
                image: userData?.image ?? null
            }
        })
    )

    return NextResponse.json({ users })
}
