import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, createAgentSlug, ensureUniqueSlug } from '@/lib/agents/db'
import { upsertAgentSchema } from '@/lib/agents/schema'

export const runtime = 'nodejs'

export async function GET() {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const { data, error } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    agents: (data ?? []).map(mapAgentRow)
  })
}

export async function POST(req: Request) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json()
  const payload = upsertAgentSchema.parse(body)

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const slug = await ensureUniqueSlug(
    createAgentSlug(payload.name),
    supabase
  )

  const { data, error } = await supabase
    .from('vibe_agents')
    .insert({
      user_id: session.user.id,
      name: payload.name,
      instructions: payload.instructions,
      file_keys: payload.fileKeys,
      tools: payload.tools,
      allow_anonymous: payload.allowAnonymous,
      agent_url: slug
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
