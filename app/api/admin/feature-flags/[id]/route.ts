import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin } from '@/lib/permissions'

export const runtime = 'nodejs'

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin(session.user.id)
    if (!isSuperAdminUser) {
        return new NextResponse('Forbidden', { status: 403 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
    })

    const { error } = await supabase
        .from('feature_flags')
        .delete()
        .eq('id', id)

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }

    return new NextResponse(null, { status: 204 })
}
