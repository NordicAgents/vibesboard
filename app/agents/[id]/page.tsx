import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc, mapConversationDoc } from '@/lib/agents/db'
import { getQrDataUrl } from '@/lib/qr'
import { AgentChatWithLayout } from '@/components/agents/agent-chat-with-layout'
import { canEditAgent } from '@/lib/agents/permissions'

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

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId ?? null
  })

  // Fetch conversations for this agent
  const tenantId = agent.tenantId
  let conversations: ReturnType<typeof mapConversationDoc>[] = []
  let handoffConversations: ReturnType<typeof mapConversationDoc>[] = []

  if (tenantId) {
    const convoSnapshot = await adminDb
      .collection(Collections.conversations(tenantId, agent.id))
      .orderBy('updatedAt', 'desc')
      .get()

    conversations = convoSnapshot.docs.map(doc =>
      mapConversationDoc(doc.data())
    )

    // Fetch conversation refs (conversations handed off to this agent)
    const refsSnapshot = await adminDb
      .collection(Collections.conversationRefs(tenantId, agent.id))
      .orderBy('lastMessageAt', 'desc')
      .limit(10)
      .get()

    for (const refDoc of refsSnapshot.docs) {
      const ref = refDoc.data()
      try {
        const srcConvoDoc = await adminDb
          .collection(Collections.conversations(tenantId, ref.sourceAgentId))
          .doc(ref.sourceConversationId)
          .get()
        if (srcConvoDoc.exists) {
          handoffConversations.push(mapConversationDoc(srcConvoDoc.data()!))
        }
      } catch {
        // Source conversation may have been deleted
      }
    }
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
  const rawProto = headersList.get('x-forwarded-proto')
  const protocol =
    (rawProto ? rawProto.split(',')[0]?.trim() : null) ??
    (headersList.get('host')?.startsWith('localhost') ? 'http' : 'https')
  const rawHost = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const host = rawHost ? rawHost.split(',')[0]?.trim() : null
  const origin =
    (protocol && host
      ? `${protocol}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  const shareUrl = `${origin}/${agent.tenantSlug ?? 'unknown'}/${agent.agentUrl}`
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
