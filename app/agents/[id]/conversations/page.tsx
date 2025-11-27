import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { AgentConversationList } from '@/components/agents/agent-conversation-list'
import { AgentConversationsAsk } from '@/components/agents/agent-conversations-ask'

export const runtime = 'nodejs'

export default async function AgentConversationsPage({
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

  return (
    <div className="container mx-auto flex-1 space-y-6 bg-beige-bg px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-switzer text-sm uppercase tracking-wider text-gray-secondary">Conversations</p>
          <h1 className="font-switzer text-3xl font-bold text-black-primary">{agent.name}</h1>
        </div>
      </div>
      <div className="space-y-6">
        <AgentConversationList agentId={agent.id} conversations={conversations} />
        <AgentConversationsAsk agentId={agent.id} conversations={conversations} />
      </div>
    </div>
  )
}
