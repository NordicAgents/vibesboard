import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { isSuperAdmin } from '@/lib/permissions'
import { validateFeatureFlagName } from '@/lib/validations'

export const runtime = 'nodejs'

/**
 * GET /api/admin/feature-flags
 * List all feature flags (authenticated users can read)
 */
export async function GET() {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 })
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    const { data, error } = await supabase
        .from('feature_flags')
        .select('*')
        .order('name', { ascending: true })

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }

    return NextResponse.json({ feature_flags: data })
}

/**
 * POST /api/admin/feature-flags
 * Create feature flag (SUPER_ADMIN only)
 */
export async function POST(req: Request) {
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

    const body = await req.json()
    const { name, description, default_value } = body

    // Validate name
    if (!name || !validateFeatureFlagName(name)) {
        return NextResponse.json(
            { error: 'Invalid feature flag name. Use UPPER_SNAKE_CASE format' },
            { status: 400 }
        )
    }

    const supabase = createRouteHandlerClient<Database>({
        cookies: () => cookieStore
    })

    // Check if feature flag already exists
    const { data: existing } = await supabase
        .from('feature_flags')
        .select('id')
        .eq('name', name)
        .single()

    if (existing) {
        return NextResponse.json(
            { error: 'Feature flag with this name already exists' },
            { status: 409 }
        )
    }

    const { data: flag, error } = await supabase
        .from('feature_flags')
        .insert({
            name,
            description,
            default_value: default_value ?? false
        })
        .select('*')
        .single()

    if (error || !flag) {
        return NextResponse.json(
            { error: error?.message || 'Failed to create feature flag' },
            { status: 500 }
        )
    }

    return NextResponse.json({ feature_flag: flag }, { status: 201 })
}
