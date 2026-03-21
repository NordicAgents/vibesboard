import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc, mapConversationDoc } from '@/lib/agents/db'
import { AgentChat } from '@/components/agent-chat'
import { canEditAgent } from '@/lib/agents/permissions'

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

 if (cid !== 'new' && tenantId) {
 const convoDoc = await adminDb
 .collection(Collections.conversations(tenantId, agent.id))
 .doc(cid)
 .get()

 if (!convoDoc.exists) {
 notFound()
 }

 const convoData = convoDoc.data()!
 if (convoData.agentId !== agent.id) {
 notFound()
 }

 const conversation = mapConversationDoc(convoData)
 conversationId = conversation.id
 initialMessages = conversation.messages
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
