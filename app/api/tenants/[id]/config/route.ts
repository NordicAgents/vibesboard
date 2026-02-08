import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { isMemberOfTenant, isSuperAdmin } from '@/lib/permissions'
import { getTenantFeatures } from '@/lib/features'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * GET /api/tenants/[id]/config
 * Get tenant configuration including features and branding
 */
export async function GET(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isMember = await isMemberOfTenant(session.user.id, id)
    if (!isSuperAdminUser && !isMember) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabaseAdmin = getServiceSupabaseClient()

    // Get tenant details
    const { data: tenant, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('*')
        .eq('id', id)
        .single()

    if (tenantError || !tenant) {
        return NextResponse.json(
            { error: 'Tenant not found' },
            { status: 404 }
        )
    }

    // Get branding
    const { data: branding } = await supabaseAdmin
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', id)
        .maybeSingle()

    // Get features
    const features = await getTenantFeatures(id)

    return NextResponse.json({
        tenant: {
            ...tenant,
            branding: branding ?? null,
            features
        },
        branding: branding ?? null,
        features
    })
}
