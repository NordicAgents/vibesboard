import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isMemberOfTenant } from '@/lib/permissions'
import { getTenantFeatures } from '@/lib/features'

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

    // Check if user is member of tenant
    const isMember = await isMemberOfTenant(session.user.id, id)
    if (!isMember) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Get tenant details
    const { data: tenant, error: tenantError } = await supabase
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
    const { data: branding } = await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', id)
        .single()

    // Get features
    const features = await getTenantFeatures(id)

    return NextResponse.json({
        tenant,
        branding,
        features
    })
}
