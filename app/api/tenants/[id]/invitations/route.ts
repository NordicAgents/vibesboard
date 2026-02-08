import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { isSuperAdmin, isTenantAdmin } from '@/lib/permissions'
import { validateEmail } from '@/lib/validations'
import { randomBytes } from 'crypto'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

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

    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)
    if (!isSuperAdminUser && !isTenantAdminUser) {
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

    const normalizedEmail = String(email).trim().toLowerCase()

    // Validate role
    if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) {
        return NextResponse.json(
            { error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' },
            { status: 400 }
        )
    }

    const supabaseAdmin = getServiceSupabaseClient()

    // Block invitations for personal workspaces
    const { data: tenant, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, is_personal')
        .eq('id', id)
        .single()

    if (tenantError || !tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    if (tenant.is_personal) {
        return NextResponse.json(
            { error: 'Personal workspaces cannot invite members' },
            { status: 403 }
        )
    }

    // Check if user is already a member (by email lookup via auth admin API)
    const { data: tenantUsers, error: tenantUsersError } = await supabaseAdmin
        .from('tenant_users')
        .select('user_id')
        .eq('tenant_id', id)

    if (tenantUsersError) {
        return NextResponse.json(
            { error: tenantUsersError.message },
            { status: 500 }
        )
    }

    for (const member of tenantUsers ?? []) {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(member.user_id)
        if (error) continue
        const memberEmail = data.user?.email?.trim().toLowerCase()
        if (memberEmail && memberEmail === normalizedEmail) {
            return NextResponse.json(
                { error: 'User is already a member of this tenant' },
                { status: 409 }
            )
        }
    }

    // Check for pending invitation
    const { data: pendingInvites, error: pendingInvitesError } = await supabaseAdmin
        .from('invitations')
        .select('id')
        .eq('tenant_id', id)
        .ilike('email', normalizedEmail)
        .eq('status', 'pending')
        .limit(1)

    if (pendingInvitesError) {
        return NextResponse.json(
            { error: pendingInvitesError.message },
            { status: 500 }
        )
    }

    if (pendingInvites && pendingInvites.length > 0) {
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
    const { data: invitation, error } = await supabaseAdmin
        .from('invitations')
        .insert({
            email: normalizedEmail,
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

    // Send invitation email via Supabase Auth
    try {
        const forwardedProto = req.headers
            .get('x-forwarded-proto')
            ?.split(',')[0]
            ?.trim()
        const forwardedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
            ?.split(',')[0]
            ?.trim()

        const origin =
            forwardedProto && forwardedHost
                ? `${forwardedProto}://${forwardedHost}`
                : process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

        const inviteUrl = `${origin}/invite/${token}`

        const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
            redirectTo: inviteUrl
        })

        if (inviteError) {
            console.error('Error sending invitation email:', inviteError)

            // If user already exists, try sending a magic link instead
            // Status 422 is returned when user is already registered
            if (inviteError.status === 422 || inviteError.message?.includes('already registered')) {
                console.log('User already registered, sending magic link')
                const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
                    email: normalizedEmail,
                    options: {
                        emailRedirectTo: inviteUrl
                    }
                })

                if (otpError) {
                    console.error('Error sending magic link:', otpError)
                }
            }
        }
    } catch (emailError) {
        // Log error but don't fail the request since the invitation was created
        console.error('Failed to send invitation email:', emailError)
    }

    const forwardedProto = req.headers
        .get('x-forwarded-proto')
        ?.split(',')[0]
        ?.trim()
    const forwardedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
        ?.split(',')[0]
        ?.trim()

    const origin =
        forwardedProto && forwardedHost
            ? `${forwardedProto}://${forwardedHost}`
            : process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

    return NextResponse.json({
        invitation,
        inviteUrl: `${origin}/invite/${token}`
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

    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isTenantAdminUser = await isTenantAdmin(session.user.id, id)
    if (!isSuperAdminUser && !isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabaseAdmin = getServiceSupabaseClient()

    // Block invitation listing for personal workspaces
    const { data: tenant, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, is_personal')
        .eq('id', id)
        .single()

    if (tenantError || !tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    if (tenant.is_personal) {
        return NextResponse.json({ invitations: [] })
    }

    const { data, error } = await supabaseAdmin
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
