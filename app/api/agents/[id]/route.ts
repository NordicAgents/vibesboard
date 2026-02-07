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
    ...(payload.quickSuggestionsMode !== undefined
      ? { quick_suggestions_mode: payload.quickSuggestionsMode }
      : {}),
    ...(payload.quickSuggestionsCount !== undefined
      ? { quick_suggestions_count: payload.quickSuggestionsCount }
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

  // Get agent to find file keys for cleanup
  const { data: agent } = await supabase
    .from('vibe_agents')
    .select('file_keys')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  // Clean up files from storage if they exist
  if (
    agent?.file_keys &&
    Array.isArray(agent.file_keys) &&
    agent.file_keys.length > 0
  ) {
    const { error: storageError } = await supabase.storage
      .from('agent-files')
      .remove(agent.file_keys as string[])

    if (storageError) {
      console.error('Error deleting agent files:', storageError)
    }
  }

  const { error } = await supabase
    .from('vibe_agents')
    .delete()
    .eq('id', id)
    .eq('user_id', session.user.id)

  if (error) {
    return new NextResponse(error.message, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
