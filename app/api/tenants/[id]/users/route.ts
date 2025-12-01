import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin, isTenantAdmin, isMemberOfTenant } from '@/lib/permissions'

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
        cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
    })

    // Get tenant users with user details from auth.users
    const { data, error } = await supabase
        .from('tenant_users')
        .select('user_id, role, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }

    // Get user details for each user_id
    // Note: In a real implementation, you'd want to fetch user emails from auth.users
    // This requires admin API access to Supabase auth
    // For now, we'll return the user_ids
    return NextResponse.json({ users: data })
}
