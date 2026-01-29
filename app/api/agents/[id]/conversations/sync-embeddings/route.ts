import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapConversationRow } from '@/lib/agents/db'
import { upsertConversationEmbeddings } from '@/lib/agent/embeddings'

export const runtime = 'nodejs'

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
    .select('*')
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
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const lastSync = (agentRow as any).last_embeddings_sync_at
    ? new Date((agentRow as any).last_embeddings_sync_at)
    : null

  const allConversations = (convoRows ?? []).map(row => mapConversationRow(row as any))
  const visitorConversations = allConversations.filter(conversation =>
    Boolean(conversation.externalId)
  )

  const nonVisitorConversationIds = allConversations
    .filter(conversation => !conversation.externalId)
    .map(conversation => conversation.id)

  if (nonVisitorConversationIds.length) {
    await supabase
      .from('vibe_agent_conversation_chunks')
      .delete()
      .in('conversation_id', nonVisitorConversationIds)
  }

  const conversations = visitorConversations.filter(conversation => {
      if (!lastSync) return true
      return new Date(conversation.updatedAt).getTime() > lastSync.getTime()
    })

  let synced = 0
  for (const conversation of conversations) {
    await upsertConversationEmbeddings({
      supabase,
      agentId: id,
      conversationId: conversation.id,
      messages: conversation.messages ?? []
    })
    synced += 1
  }

  const syncTime = new Date().toISOString()
  await supabase
    .from('vibe_agents')
    .update({ last_embeddings_sync_at: syncTime } as any)
    .eq('id', id)

  return NextResponse.json({ synced, lastSync: syncTime })
}
