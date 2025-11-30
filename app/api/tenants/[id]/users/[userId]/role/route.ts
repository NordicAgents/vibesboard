import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin, isTenantAdmin } from '@/lib/permissions'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
        userId: string
    }>
}

/**
 * PUT /api/tenants/[id]/users/[userId]/role
 * Update member role (SUPER_ADMIN or TENANT_ADMIN)
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id, userId } = await params

    // Check if user is super admin or tenant admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)

    if (!isSuperAdminUser && !isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    // Prevent users from changing their own role (unless super admin)
    if (session.user.id === userId && !isSuperAdminUser) {
        return NextResponse.json(
            { error: 'Cannot change your own role' },
            { status: 400 }
        )
    }

    const body = await req.json()
    const { role } = body

    if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) {
        return NextResponse.json(
            { error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' },
            { status: 400 }
        )
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    const { data, error } = await supabase
        .from('tenant_users')
        .update({ role })
        .eq('tenant_id', id)
        .eq('user_id', userId)
        .select('*')
        .single()

    if (error || !data) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update role' },
            { status: 500 }
        )
    }

    return NextResponse.json({ success: true, user: data })
}

/**
 * DELETE /api/tenants/[id]/users/[userId]/role
 * Remove user from tenant
 */
export async function DELETE(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id, userId } = await params

    // Check if user is super admin or tenant admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)

    if (!isSuperAdminUser && !isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    // Prevent users from removing themselves
    if (session.user.id === userId) {
        return NextResponse.json(
            { error: 'Cannot remove yourself from tenant' },
            { status: 400 }
        )
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    const { error } = await supabase
        .from('tenant_users')
        .delete()
        .eq('tenant_id', id)
        .eq('user_id', userId)

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }

    return NextResponse.json({ success: true })
}
