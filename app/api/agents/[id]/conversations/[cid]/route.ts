import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapConversationRow } from '@/lib/agents/db'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: { id: string; cid: string } }
) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const { data, error } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('id', params.cid)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.agent_id !== params.id) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json({ conversation: mapConversationRow(data) })
}
