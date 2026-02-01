import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { isMemberOfTenant } from '@/lib/permissions'
import { setActiveTenantId, ensureActiveTenant } from '@/lib/tenant-context'

export const runtime = 'nodejs'

/**
 * GET /api/user/active-tenant
 * Get user's active tenant
 */
export async function GET(req: Request) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    try {
        const tenantId = await ensureActiveTenant(session.user.id)
        if (!tenantId) {
            return NextResponse.json({ error: 'No tenant found' }, { status: 404 })
        }
        return NextResponse.json({ tenant_id: tenantId })
    } catch (error) {
        console.error('Error getting active tenant:', error)
        return NextResponse.json({ error: 'Failed to get active tenant' }, { status: 500 })
    }
}

/**
 * PUT /api/user/active-tenant
 * Set user's active tenant
 */
export async function PUT(req: Request) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await req.json()
    const { tenant_id } = body

    if (!tenant_id) {
        return NextResponse.json(
            { error: 'tenant_id is required' },
            { status: 400 }
        )
    }

    // Verify user is member of the tenant
    const isMember = await isMemberOfTenant(session.user.id, tenant_id)

    if (!isMember) {
        return NextResponse.json(
            { error: 'You are not a member of this tenant' },
            { status: 403 }
        )
    }

    // Set active tenant in cookie
    await setActiveTenantId(tenant_id)

    return NextResponse.json({ success: true })
}
