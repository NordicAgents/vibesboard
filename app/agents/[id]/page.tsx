import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { AgentAskChat } from '@/components/agents/agent-ask-chat'

export const runtime = 'nodejs'

export default async function AgentPageAsChat({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const supabase = createServerComponentClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const { data: agentRow } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!agentRow) {
    notFound()
  }

  const agent = mapAgentRow(agentRow)

  const { data: convoRows } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', agent.id)
    .order('updated_at', { ascending: false })

  const conversations = (convoRows ?? []).map(mapConversationRow)
  const ownerConversations = conversations.filter(
    conversation => conversation.userId === session.user.id
  )

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <AgentAskChat
        agent={agent}
        ownerId={session.user.id}
        ownerSessions={ownerConversations}
      />
    </div>
  )
}
