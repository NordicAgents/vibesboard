import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'

export const runtime = 'nodejs'

type RouteParams = {
    params: Promise<{
        token: string
    }>
}

/**
 * POST /api/invitations/[token]/accept
 * Accept invitation (authenticated user)
 */
export async function POST(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { token } = await params

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Get invitation
    const { data: invitation, error: inviteError } = await supabase
        .from('invitations')
        .select('*')
        .eq('token', token)
        .single()

    if (inviteError || !invitation) {
        return NextResponse.json(
            { error: 'Invitation not found' },
            { status: 404 }
        )
    }

    // Check if invitation is expired
    const now = new Date()
    const expiresAt = new Date(invitation.expires_at)

    if (now > expiresAt) {
        return NextResponse.json(
            { error: 'Invitation has expired' },
            { status: 410 }
        )
    }

    // Check if invitation is already accepted
    if (invitation.status === 'accepted') {
        return NextResponse.json(
            { error: 'Invitation has already been accepted' },
            { status: 410 }
        )
    }

    // Verify email matches (optional - could also allow accepting with different email)
    // For now, we'll allow any authenticated user to accept

    // Check if user is already a member
    const { data: existingMember } = await supabase
        .from('tenant_users')
        .select('user_id')
        .eq('tenant_id', invitation.tenant_id)
        .eq('user_id', session.user.id)
        .single()

    if (existingMember) {
        return NextResponse.json(
            { error: 'You are already a member of this tenant' },
            { status: 409 }
        )
    }

    // Create tenant_users record
    const { error: memberError } = await supabase
        .from('tenant_users')
        .insert({
            user_id: session.user.id,
            tenant_id: invitation.tenant_id,
            role: invitation.role
        })

    if (memberError) {
        return NextResponse.json(
            { error: memberError.message },
            { status: 500 }
        )
    }

    // Mark invitation as accepted
    const { error: updateError } = await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id)

    if (updateError) {
        // Log error but don't fail the request since user was already added
        console.error('Failed to mark invitation as accepted:', updateError)
    }

    return NextResponse.json({
        success: true,
        tenant_id: invitation.tenant_id
    })
}
