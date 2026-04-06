import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc, mapConversationDoc } from '@/lib/agents/db'
import { AgentChat } from '@/components/agent-chat'
import { canEditAgent } from '@/lib/agents/permissions'
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

  // Find the agent across all tenants using collection group query
  const agentSnapshot = await adminDb
    .collectionGroup('agents')
    .where('id', '==', id)
    .limit(1)
    .get()

  if (agentSnapshot.empty) {
    notFound()
  }

  const agentData = agentSnapshot.docs[0].data()
  const agent = mapAgentDoc(agentData)
  const tenantId = agent.tenantId

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.userId,
    tenantId: tenantId ?? null
  })

  let conversationId: string | undefined
  let initialMessages
  let conversation: ReturnType<typeof mapConversationDoc> | undefined

  if (cid !== 'new' && tenantId) {
    let convoDoc = await adminDb
      .collection(Collections.conversations(tenantId, agent.id))
      .doc(cid)
      .get()

    // If not found directly, check if this agent has a conversation ref for it
    if (!convoDoc.exists) {
      const refDoc = await adminDb
        .collection(Collections.conversationRefs(tenantId, agent.id))
        .doc(cid)
        .get()

      if (refDoc.exists) {
        const refData = refDoc.data()!
        convoDoc = await adminDb
          .collection(Collections.conversations(tenantId, refData.sourceAgentId))
          .doc(refData.sourceConversationId)
          .get()
      }

      if (!convoDoc.exists) {
        notFound()
      }
    }

    const convoData = convoDoc.data()!
    conversation = mapConversationDoc(convoData)
    conversationId = conversation.id
    initialMessages = conversation.messages
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
