import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, createAgentSlug, ensureUniqueSlug } from '@/lib/agents/db'
import { getUserActiveTenant } from '@/lib/permissions'
import { ensurePersonalTenant } from '@/lib/tenant-context'
import { upsertAgentSchema } from '@/lib/agents/schema'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenant_id')

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  let query = supabase
    .from('vibe_agents')
    .select('*')
    .order('created_at', { ascending: false })

  if (tenantId) {
    // If tenant_id is provided, filter by it
    // Note: We assume RLS or middleware ensures the user has access to this tenant
    // But we can also add a check here if needed
    query = query.eq('tenant_id', tenantId)
  } else {
    // Fallback: show agents created by the user (legacy behavior)
    query = query.eq('user_id', session.user.id)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    agents: (data ?? []).map(mapAgentRow)
  })
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json()
  const payload = upsertAgentSchema.parse(body)

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  // Resolve the tenant the new agent should belong to.
  // For now, use the user's active tenant (or first available tenant).
  // If none exists, create/fetch a personal workspace so they can proceed.
  let tenantId = await getUserActiveTenant(session.user.id)
  if (!tenantId) {
    try {
      tenantId = await ensurePersonalTenant(session.user.id)
    } catch (error) {
      console.error('Failed to ensure personal tenant:', error)
    }
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'No tenant available for this user; ensure tenant membership exists.' },
      { status: 400 }
    )
  }

  const slug = await ensureUniqueSlug(
    createAgentSlug(payload.name),
    supabase
  )

  const { data, error } = await supabase
    .from('vibe_agents')
    .insert({
      user_id: session.user.id,
      tenant_id: tenantId,
      name: payload.name,
      instructions: payload.instructions,
      file_keys: payload.fileKeys,
      tools: payload.tools,
      allow_anonymous: payload.allowAnonymous,
      agent_url: slug,
      ...(payload.greetingText !== undefined
        ? { greeting_text: payload.greetingText }
        : {})
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Unable to create agent' },
      { status: 500 }
    )
  }

  return NextResponse.json({ agent: mapAgentRow(data) })
}
