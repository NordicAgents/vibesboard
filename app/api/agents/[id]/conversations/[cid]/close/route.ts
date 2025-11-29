import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapConversationRow } from '@/lib/agents/db'
import { summarizeConversation } from '@/lib/agent/summarize'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const { id, cid } = await params
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

  const { data: convoRow, error: convoError } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('id', cid)
    .maybeSingle()

  if (convoError) {
    return NextResponse.json({ error: convoError.message }, { status: 500 })
  }

  if (!convoRow || convoRow.agent_id !== id) {
    return new NextResponse('Not found', { status: 404 })
  }

  const conversation = mapConversationRow(convoRow as any)
  let summary = conversation.summary ?? null
  let summaryGeneratedAt = conversation.summaryGeneratedAt ?? null

  if (!summary) {
    summary = await summarizeConversation(conversation.messages)
    summaryGeneratedAt = summary ? new Date().toISOString() : summaryGeneratedAt
  }

  const closedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('vibe_agent_conversations')
    .update({
      closed_at: closedAt,
      summary,
      summary_generated_at: summaryGeneratedAt,
      updated_at: closedAt
    } as any)
    .eq('id', cid)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, summary, closedAt })
}
