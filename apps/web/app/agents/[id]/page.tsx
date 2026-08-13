import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { type VibeAgentConversation } from '@vibesboard/contracts'
import { getAgentById } from '@vibesboard/agents/server'
import {
  listAgentConversations,
  listHandoffConversationsForAgent
} from '@vibesboard/agents/conversations'
import { getQrDataUrl } from '@/lib/qr'
import { buildShareUrl } from '@/lib/share-url'
import { AgentChatWithLayout } from '@/components/agents/agent-chat-with-layout'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

export default async function AgentPageAsChat({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const query = await searchParams
  // Support both new ?tab= param and legacy ?configure=true
  const activeTab =
    typeof query.tab === 'string'
      ? query.tab
      : query.configure === 'true'
        ? 'configure'
        : null
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const agent = await getAgentById(id)

  if (!agent) {
    notFound()
  }

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId ?? null
  })

  // Fetch conversations for this agent
  const tenantId = agent.tenantId
  let conversations: VibeAgentConversation[] = []
  let handoffConversations: VibeAgentConversation[] = []

  if (tenantId) {
    conversations = await listAgentConversations(tenantId, agent.id)
    // Conversations handed off to this agent (derived from handoffChain).
    handoffConversations = await listHandoffConversationsForAgent(
      tenantId,
      agent.id
    )
  }

  const ownerConversations = conversations.filter(
    conversation => conversation.userId === session.user.id
  )
  const visitorConversations = canEdit
    ? conversations.filter(conversation => conversation.externalId)
    : []
  const lastSync = agent.lastEmbeddingsSyncAt
    ? new Date(agent.lastEmbeddingsSyncAt)
    : null
  const hasUnsyncedConversations = canEdit
    ? visitorConversations.some(conversation =>
        lastSync
          ? new Date(conversation.updatedAt).getTime() > lastSync.getTime()
          : true
      )
    : false

  const headersList = await headers()
  const shareUrl = buildShareUrl(headersList, agent.tenantSlug, agent.agentUrl)
  const qrDataUrl = await getQrDataUrl(shareUrl)

  return (
    <AgentChatWithLayout
      agent={agent}
      ownerId={session.user.id}
      ownerSessions={ownerConversations}
      visitorSessions={visitorConversations}
      handoffConversations={handoffConversations}
      hasUnsyncedConversations={hasUnsyncedConversations}
      share={{ url: shareUrl, qrDataUrl }}
      activeTab={canEdit ? activeTab : null}
      canEdit={canEdit}
    />
  )
}
