import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { type VibeAgentConversation } from '@vibesboard/contracts'
import { getAgentById } from '@vibesboard/agents/server'
import {
  getConversation,
  getConversationAnyAgent
} from '@vibesboard/agents/conversations'
import { AgentChat } from '@/components/agent-chat'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { HandoffConversationPage } from './handoff-page'

export const runtime = 'nodejs'

export default async function AgentConversationPage({
  params
}: {
  params: Promise<{ id: string; cid: string }>
}) {
  const { id, cid } = await params
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const agent = await getAgentById(id)

  if (!agent) {
    notFound()
  }

  const tenantId = agent.tenantId

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.userId,
    tenantId: tenantId ?? null
  })

  let conversationId: string | undefined
  let initialMessages
  let conversation: VibeAgentConversation | undefined

  if (cid !== 'new' && tenantId) {
    let found = await getConversation(tenantId, agent.id, cid)

    // Handoff fallback: the conversation may live under another agent but was
    // handed off to (and is viewable by) this one. With a single conversations
    // table, look it up cross-agent within the tenant.
    if (!found) {
      found = await getConversationAnyAgent(tenantId, cid)
    }

    if (!found) {
      notFound()
    }

    conversation = found
    conversationId = found.id
    initialMessages = found.messages
  }

  // Handed-off Chatwoot conversations get the human reply UI
  if (
    conversation?.handedOff &&
    conversation.externalId?.startsWith('chatwoot:') &&
    canEdit
  ) {
    return (
      <div className="flex h-full flex-col bg-[#f7f7f5] dark:bg-[#222f30]">
        <HandoffConversationPage
          conversation={conversation}
          agentId={agent.id}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <AgentChat
        agent={agent}
        endpoint={`/api/agents/${agent.id}/chat`}
        conversationId={conversationId}
        initialMessages={initialMessages}
      />
    </div>
  )
}
