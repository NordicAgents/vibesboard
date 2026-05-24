import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { mapAgentDoc, mapConversationDoc } from '@vibesboard/agents/db'
import { getConversation } from '@vibesboard/agents/conversations'
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
    const found = await getConversation(tenantId, agent.id, cid)

    if (found) {
      conversation = found
      conversationId = found.id
      initialMessages = found.messages
    } else {
      // If not found directly, check if this agent has a conversation ref for it
      // (handoff refs remain Firestore-backed until 4b).
      const refDoc = await adminDb
        .collection(Collections.conversationRefs(tenantId, agent.id))
        .doc(cid)
        .get()

      let convoDoc:
        | FirebaseFirestore.DocumentSnapshot
        | undefined

      if (refDoc.exists) {
        const refData = refDoc.data()!
        convoDoc = await adminDb
          .collection(
            Collections.conversations(tenantId, refData.sourceAgentId)
          )
          .doc(refData.sourceConversationId)
          .get()
      }

      if (!convoDoc?.exists) {
        notFound()
      }

      conversation = mapConversationDoc(convoDoc.data()!)
      conversationId = conversation.id
      initialMessages = conversation.messages
    }
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
