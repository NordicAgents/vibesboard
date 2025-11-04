import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow } from '@/lib/agents/db'
import { patchAgentSchema } from '@/lib/agents/schema'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!data) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json({ agent: mapAgentRow(data) })
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json()
  const payload = patchAgentSchema.parse(body)

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const updates: Partial<Database['public']['Tables']['vibe_agents']['Update']> =
    {
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.instructions ? { instructions: payload.instructions } : {}),
      ...(payload.fileKeys !== undefined
        ? { file_keys: payload.fileKeys }
        : {}),
      ...(payload.tools !== undefined ? { tools: payload.tools } : {}),
      ...(typeof payload.allowAnonymous === 'boolean'
        ? { allow_anonymous: payload.allowAnonymous }
        : {}),
      updated_at: new Date().toISOString()
    }

  const { data, error } = await supabase
    .from('vibe_agents')
    .update(updates)
    .eq('id', params.id)
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
  _req: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  await supabase
    .from('vibe_agents')
    .delete()
    .eq('id', params.id)
    .eq('user_id', session.user.id)

  return new NextResponse(null, { status: 204 })
}
