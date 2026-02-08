import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { maskEmail } from '@/lib/email'
import { isSuperAdmin, isTenantAdmin } from '@/lib/permissions'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        token: string
    }>
}

/**
 * GET /api/invitations/[token]
 * Get invitation details (public)
 */
export async function GET(req: Request, { params }: RouteParams) {
    const { token } = await params

    const supabaseAdmin = getServiceSupabaseClient()

    const { data: invitation, error } = await supabaseAdmin
        .from('invitations')
        .select('*, tenants(name, slug)')
        .eq('token', token)
        .single()

    if (error || !invitation) {
        return NextResponse.json(
            { error: 'Invitation not found' },
            { status: 404 }
        )
    }

    // Check if invitation is expired
    const now = new Date()
    const expiresAt = new Date(invitation.expires_at)

    if (invitation.status === 'expired' && now < expiresAt) {
        const nowIso = now.toISOString()
        await supabaseAdmin
            .from('invitations')
            .update({ expires_at: nowIso })
            .eq('id', invitation.id)

        invitation.expires_at = nowIso
    }

    if (now > expiresAt) {
        // Mark as expired if not already
        if (invitation.status === 'pending') {
            await supabaseAdmin
                .from('invitations')
                .update({ status: 'expired' })
                .eq('id', invitation.id)

            invitation.status = 'expired'
        }
    }

    const { data: invitedByData } = await supabaseAdmin.auth.admin.getUserById(
        invitation.created_by
    )

    const responseInvitation = {
        id: invitation.id,
        tenant_id: invitation.tenant_id,
        tenant_name: invitation.tenants?.name ?? 'Unknown tenant',
        email: maskEmail(invitation.email),
        role: invitation.role,
        status: invitation.status,
        created_at: invitation.created_at,
        expires_at: invitation.expires_at,
        accepted_at: invitation.accepted_at ?? null,
        invited_by_email: invitedByData.user?.email ?? 'Unknown'
    }

    return NextResponse.json({ invitation: responseInvitation })
}

/**
 * DELETE /api/invitations/[id]
 * Cancel invitation (TENANT_ADMIN or SUPER_ADMIN)
 */
export async function DELETE(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    // Note: this route param is `[token]` for historical reasons.
    // For DELETE requests we treat it as an invitation ID.
    const { token: invitationId } = await params

    const supabaseAdmin = getServiceSupabaseClient()

    const { data: invitation, error } = await supabaseAdmin
        .from('invitations')
        .select('id, tenant_id, status')
        .eq('id', invitationId)
        .single()

    if (error || !invitation) {
        return NextResponse.json(
            { error: 'Invitation not found' },
            { status: 404 }
        )
    }

    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    const isTenantAdminUser = await isTenantAdmin(session.user.id, invitation.tenant_id)

    if (!isSuperAdminUser && !isTenantAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    if (invitation.status === 'accepted') {
        return NextResponse.json(
            { error: 'Cannot cancel an accepted invitation' },
            { status: 400 }
        )
    }

    const { error: updateError } = await supabaseAdmin
        .from('invitations')
        .update({ status: 'expired', expires_at: new Date().toISOString() })
        .eq('id', invitation.id)

    if (updateError) {
        return NextResponse.json(
            { error: updateError.message },
            { status: 500 }
        )
    }

    return new NextResponse(null, { status: 204 })
}
