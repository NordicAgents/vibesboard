import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapConversationRow } from '@/lib/agents/db'
import { summarizeConversation } from '@/lib/agent/summarize'

export const runtime = 'nodejs'

const MAX_REFRESH = 20

export async function POST(
  _req: Request,
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

  const { data: agentRow } = await supabase
    .from('vibe_agents')
    .select('id, user_id')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!agentRow) {
    return new NextResponse('Not found', { status: 404 })
  }

  const { data: convoRows, error } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', id)
    .is('user_id', null)
    .not('external_id', 'is', null)
    .is('summary', null)
    .order('updated_at', { ascending: false })
    .limit(MAX_REFRESH)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!convoRows?.length) {
    return NextResponse.json({ updated: 0 })
  }

  let updatedCount = 0
  for (const row of convoRows) {
    const conversation = mapConversationRow(row as any)
    const summary = await summarizeConversation(conversation.messages)
    if (!summary) {
      continue
    }
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('vibe_agent_conversations')
      .update({
        summary,
        summary_generated_at: now,
        updated_at: now
      } as any)
      .eq('id', conversation.id)

    if (!updateError) {
      updatedCount += 1
    }
  }

  return NextResponse.json({ updated: updatedCount })
}
