import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isTenantAdmin } from '@/lib/permissions'
import { validateEmail } from '@/lib/validations'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        id: string
    }>
}

/**
 * POST /api/tenants/[id]/invitations
 * Create invitation (TENANT_ADMIN)
 */
export async function POST(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    // Check if user is tenant admin
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)
    if (!isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const body = await req.json()
    const { email, role } = body

    // Validate email
    if (!email || !validateEmail(email)) {
        return NextResponse.json(
            { error: 'Invalid email address' },
            { status: 400 }
        )
    }

    // Validate role
    if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) {
        return NextResponse.json(
            { error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' },
            { status: 400 }
        )
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Check if user is already a member
    const { data: existingUser } = await supabase
        .rpc('get_user_by_email', { p_email: email })
        .single()

    if (existingUser) {
        // Check if already a member of this tenant
        const { data: existingMember } = await supabase
            .from('tenant_users')
            .select('user_id')
            .eq('tenant_id', id)
            .eq('user_id', existingUser.id)
            .single()

        if (existingMember) {
            return NextResponse.json(
                { error: 'User is already a member of this tenant' },
                { status: 409 }
            )
        }
    }

    // Check for pending invitation
    const { data: existingInvitation } = await supabase
        .from('invitations')
        .select('id')
        .eq('tenant_id', id)
        .eq('email', email)
        .eq('status', 'pending')
        .single()

    if (existingInvitation) {
        return NextResponse.json(
            { error: 'Invitation already sent to this email' },
            { status: 409 }
        )
    }

    // Generate secure token
    const token = randomBytes(32).toString('hex')

    // Set expiry (7 days from now)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Create invitation
    const { data: invitation, error } = await supabase
        .from('invitations')
        .insert({
            email,
            tenant_id: id,
            token,
            role,
            status: 'pending',
            expires_at: expiresAt.toISOString(),
            created_by: session.user.id
        })
        .select('*')
        .single()

    if (error || !invitation) {
        return NextResponse.json(
            { error: error?.message || 'Failed to create invitation' },
            { status: 500 }
        )
    }

    // TODO: Send invitation email via Supabase Auth
    // This would require configuring email templates in Supabase
    // For now, return the invitation with the token

    return NextResponse.json({
        invitation,
        inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invite/${token}`
    }, { status: 201 })
}

/**
 * GET /api/tenants/[id]/invitations
 * List invitations for a tenant
 */
export async function GET(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    // Check if user is tenant admin
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)
    if (!isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }

    return NextResponse.json({ invitations: data })
}
