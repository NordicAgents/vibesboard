import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin, isTenantAdmin } from '@/lib/permissions'
import { validateBrandingColors, validateUrl } from '@/lib/validations'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * PUT /api/tenants/[id]/branding
 * Update tenant branding (SUPER_ADMIN or TENANT_ADMIN)
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
    const { logo_url, primary_color, secondary_color } = body

    // Validate colors if provided
    if ((primary_color || secondary_color) &&
        !validateBrandingColors(
            primary_color || '#000000',
            secondary_color || '#ffffff'
        )) {
        return NextResponse.json(
            { error: 'Invalid color format. Use hex colors (e.g., #000000)' },
            { status: 400 }
        )
    }

    // Validate logo URL if provided
    if (logo_url && logo_url !== '' && !validateUrl(logo_url)) {
        return NextResponse.json(
            { error: 'Invalid logo URL format' },
            { status: 400 }
        )
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Build update object
    const updates: any = {}
    if (logo_url !== undefined) updates.logo_url = logo_url || null
    if (primary_color !== undefined) updates.primary_color = primary_color
    if (secondary_color !== undefined) updates.secondary_color = secondary_color

    if (Object.keys(updates).length === 0) {
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 }
        )
    }

    const { data: branding, error } = await supabase
        .from('tenant_branding')
        .update(updates)
        .eq('tenant_id', id)
        .select('*')
        .single()

    if (error || !branding) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update branding' },
            { status: 500 }
        )
    }

    return NextResponse.json({ branding })
}
