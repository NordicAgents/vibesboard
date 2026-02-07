import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin } from '@/lib/permissions'
import { validateTenantSlug, validateTenantName, generateSlug } from '@/lib/validations'

export const runtime = 'nodejs'

/**
 * GET /api/admin/tenants
 * List all tenants (SUPER_ADMIN only)
 */
export async function GET(req: Request) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    if (!isSuperAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
    })

    // Get pagination parameters
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const status = searchParams.get('status')
    const offset = (page - 1) * limit

    // Build query
    let query = supabase
        .from('tenants')
        .select('*, tenant_users(count)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    // Apply status filter if provided
    if (status && ['active', 'trial', 'suspended'].includes(status)) {
        query = query.eq('status', status as 'active' | 'trial' | 'suspended')
    }

    const { data, error, count } = await query

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
        tenants: data,
        pagination: {
            page,
            limit,
            total: count || 0,
            totalPages: Math.ceil((count || 0) / limit)
        }
    })
}

/**
 * POST /api/admin/tenants
 * Create new tenant (SUPER_ADMIN only)
 */
export async function POST(req: Request) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    if (!isSuperAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const body = await req.json()
    const { name, slug: providedSlug, created_by } = body

    // Validate input
    if (!name || !validateTenantName(name)) {
        return NextResponse.json(
            { error: 'Invalid tenant name' },
            { status: 400 }
        )
    }

    // Generate or validate slug
    const slug = providedSlug || generateSlug(name)
    if (!validateTenantSlug(slug)) {
        return NextResponse.json(
            { error: 'Invalid tenant slug' },
            { status: 400 }
        )
    }

    const createdBy = created_by || session.user.id

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
    })

    // Check if slug already exists
    const { data: existing } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', slug)
        .single()

    if (existing) {
        return NextResponse.json(
            { error: 'Tenant slug already exists' },
            { status: 409 }
        )
    }

    // Create tenant
    const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
            name,
            slug,
            status: 'active',
            created_by: createdBy,
            is_personal: false
        })
        .select('*')
        .single()

    if (tenantError || !tenant) {
        return NextResponse.json(
            { error: tenantError?.message || 'Failed to create tenant' },
            { status: 500 }
        )
    }

    // Create tenant branding record
    const { error: brandingError } = await supabase
        .from('tenant_branding')
        .insert({
            tenant_id: tenant.id
        })

    if (brandingError) {
        console.error('Failed to create tenant branding:', brandingError)

        // Rollback: delete the tenant if branding creation fails
        await supabase
            .from('tenants')
            .delete()
            .eq('id', tenant.id)

        return NextResponse.json(
            { error: 'Failed to create tenant branding, rolled back tenant creation' },
            { status: 500 }
        )
    }

    return NextResponse.json({ tenant }, { status: 201 })
}
