import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin, isTenantAdmin } from '@/lib/permissions'
import { toggleFeature } from '@/lib/features'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * PUT /api/tenants/[id]/features
 * Toggle features for a tenant (SUPER_ADMIN or TENANT_ADMIN)
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    // Check if user is super admin or tenant admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)

    if (!isSuperAdminUser && !isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const body = await req.json()
    const { feature_flag_id, is_enabled } = body

    if (!feature_flag_id || typeof is_enabled !== 'boolean') {
        return NextResponse.json(
            { error: 'Invalid request. Provide feature_flag_id and is_enabled' },
            { status: 400 }
        )
    }

    const result = await toggleFeature(id, feature_flag_id, is_enabled)

    if (!result.success) {
        return NextResponse.json(
            { error: result.error || 'Failed to toggle feature' },
            { status: 500 }
        )
    }

    return NextResponse.json({ success: true })
}
