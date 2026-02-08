import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { isMemberOfTenant, isSuperAdmin } from '@/lib/permissions'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

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

    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isMember = await isMemberOfTenant(session.user.id, id)
    if (!isSuperAdminUser && !isMember) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabaseAdmin = getServiceSupabaseClient()

    // Get tenant users with user details from auth.users
    const { data, error } = await supabaseAdmin
        .from('tenant_users')
        .select('user_id, tenant_id, role, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }

    const emailCache = new Map<string, Promise<string | null>>()
    const getEmail = (userId: string) => {
        const existing = emailCache.get(userId)
        if (existing) return existing

        const promise = supabaseAdmin.auth.admin
            .getUserById(userId)
            .then(({ data, error }) => {
                if (error) return null
                return data.user?.email ?? null
            })
            .catch(() => null)

        emailCache.set(userId, promise)
        return promise
    }

    const users = await Promise.all(
        (data ?? []).map(async (row) => ({
            ...row,
            email: await getEmail(row.user_id)
        }))
    )

    return NextResponse.json({ users })
}
