import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { AgentChat } from '@/components/agent-chat'
import { canEditAgent } from '@/lib/agents/permissions'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

export const runtime = 'nodejs'

export default async function AgentConversationPage({
  params
}: {
  params: Promise<{ id: string; cid: string }>
}) {
  const { id, cid } = await params
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
    .maybeSingle()

  if (!agentRow) {
    notFound()
  }

  const agent = mapAgentRow(agentRow)
  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agentRow.user_id,
    tenantId: agentRow.tenant_id
  })
  let conversationId: string | undefined
  let initialMessages

  if (cid !== 'new') {
    const conversationClient = canEdit ? getServiceSupabaseClient() : supabase
    const { data } = await conversationClient
        .from('vibe_agent_conversations')
        .select('*')
        .eq('id', cid)
        .maybeSingle()

    if (!data || data.agent_id !== agent.id) {
      notFound()
    }

    const conversation = mapConversationRow(data)
    conversationId = conversation.id
    initialMessages = conversation.messages
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <AgentChat
        agent={agent}
        endpoint={`/api/agents/${agent.id}/chat`}
        conversationId={conversationId}
        initialMessages={initialMessages}
      />
    </div>
  )
}
