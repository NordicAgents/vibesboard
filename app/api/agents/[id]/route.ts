import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow } from '@/lib/agents/db'
import { patchAgentSchema } from '@/lib/agents/schema'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!data) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json({ agent: mapAgentRow(data) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json()
  const payload = patchAgentSchema.parse(body)

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const updates: Partial<
    Database['public']['Tables']['vibe_agents']['Update']
  > = {
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.instructions ? { instructions: payload.instructions } : {}),
    ...(payload.fileKeys !== undefined ? { file_keys: payload.fileKeys } : {}),
    ...(payload.tools !== undefined ? { tools: payload.tools } : {}),
    ...(typeof payload.allowAnonymous === 'boolean'
      ? { allow_anonymous: payload.allowAnonymous }
      : {}),
    ...(payload.greetingText !== undefined
      ? { greeting_text: payload.greetingText }
      : {}),
    ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
    ...(payload.maxMessages !== undefined
      ? { max_messages: payload.maxMessages }
      : {}),
    updated_at: new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('vibe_agents')
    .update(updates)
    .eq('id', id)
    .eq('user_id', session.user.id)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Unable to update agent' },
      { status: 500 }
    )
  }

  return NextResponse.json({ agent: mapAgentRow(data) })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  await supabase
    .from('vibe_agents')
    .delete()
    .eq('id', id)
    .eq('user_id', session.user.id)

  return new NextResponse(null, { status: 204 })
}
