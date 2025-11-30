import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin, isMemberOfTenant } from '@/lib/permissions'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/admin/tenants/[id]
 * Get single tenant details (SUPER_ADMIN or tenant member)
 */
export async function GET(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    // Check if user is super admin or member of tenant
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isMember = await isMemberOfTenant(session.user.id, id)

    if (!isSuperAdminUser && !isMember) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    const { data: tenant, error } = await supabase
        .from('tenants')
        .select('*, tenant_branding(*), tenant_users(count)')
        .eq('id', id)
        .single()

    if (error || !tenant) {
        return NextResponse.json(
            { error: 'Tenant not found' },
            { status: 404 }
        )
    }

    return NextResponse.json({ tenant })
}

/**
 * PUT /api/admin/tenants/[id]
 * Update tenant (SUPER_ADMIN only)
 */
export async function PUT(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    if (!isSuperAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const body = await req.json()
    const { name, slug, status } = body

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Build update object
    const updates: any = {}
    if (name !== undefined) updates.name = name
    if (slug !== undefined) updates.slug = slug
    if (status !== undefined && ['active', 'trial', 'suspended'].includes(status)) {
        updates.status = status
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 }
        )
    }

    const { data: tenant, error } = await supabase
        .from('tenants')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()

    if (error || !tenant) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update tenant' },
            { status: 500 }
        )
    }

    return NextResponse.json({ tenant })
}

/**
 * DELETE /api/admin/tenants/[id]
 * Soft delete tenant (SUPER_ADMIN only)
 * Note: In this implementation, we're using hard delete due to RLS constraints
 * In production, you might want to add a soft delete mechanism
 */
export async function DELETE(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    if (!isSuperAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Alternatively, just mark as suspended
    const { data: tenant, error } = await supabase
        .from('tenants')
        .update({ status: 'suspended' })
        .eq('id', id)
        .select('*')
        .single()

    if (error || !tenant) {
        return NextResponse.json(
            { error: error?.message || 'Failed to delete tenant' },
            { status: 500 }
        )
    }

    return NextResponse.json({ success: true, tenant })
}
