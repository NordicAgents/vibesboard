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
 * GET /api/invitations/[token]
 * Get invitation details (public for logged-in users)
 */
export async function GET(req: Request, { params }: RouteParams) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const { token } = await params

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
    })

    const { data: invitation, error } = await supabase
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

    if (now > expiresAt) {
        // Mark as expired if not already
        if (invitation.status === 'pending') {
            await supabase
                .from('invitations')
                .update({ status: 'expired' })
                .eq('id', invitation.id)
        }

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

    return NextResponse.json({ invitation })
}
