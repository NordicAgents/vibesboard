import { NextResponse } from 'next/server'
import {
  requireTenantMember,
  requireSuperAdmin
} from '@/lib/auth/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'

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

  // Allow super admins to access any tenant's users (e.g. from admin panel)
  const superAdminAuth = await requireSuperAdmin()
  if (!superAdminAuth.ok) {
    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response
  }

  // Get all members
  const membersSnapshot = await adminDb
    .collection(Collections.members(tenantId))
    .get()

  // Fetch user details for each member
  const users = await Promise.all(
    membersSnapshot.docs.map(async (memberDoc: any) => {
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
