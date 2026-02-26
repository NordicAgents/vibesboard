import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getAgentById } from '@/lib/agents/server'
import { mapConversationDoc } from '@/lib/agents/db'
import { upsertConversationEmbeddings } from '@/lib/agent/embeddings'
import { limitConcurrency } from '@/lib/async-utils'
import { canEditAgent } from '@/lib/agents/permissions'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const { user } = authResult

  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const convCollPath = Collections.conversations(agent.tenantId, agent.id)
  const snapshot = await adminDb
    .collection(convCollPath)
    .orderBy('updatedAt', 'desc')
    .get()

  const lastSync = agent.lastEmbeddingsSyncAt
    ? new Date(agent.lastEmbeddingsSyncAt)
    : null

  const allConversations = snapshot.docs.map(doc =>
    mapConversationDoc(doc.data())
  )
  const visitorConversations = allConversations.filter(conversation =>
    Boolean(conversation.externalId)
  )

  const nonVisitorConversationIds = allConversations
    .filter(conversation => !conversation.externalId)
    .map(conversation => conversation.id)

  // Delete chunks for non-visitor conversations
  if (nonVisitorConversationIds.length) {
    const chunksCollPath = Collections.conversationChunks(
      agent.tenantId,
      agent.id
    )
    for (const convId of nonVisitorConversationIds) {
      const chunkSnapshot = await adminDb
        .collection(chunksCollPath)
        .where('conversationId', '==', convId)
        .get()

      if (!chunkSnapshot.empty) {
        const batch = adminDb.batch()
        chunkSnapshot.docs.forEach(doc => batch.delete(doc.ref))
        await batch.commit()
      }
    }
  }

  const conversations = visitorConversations.filter(conversation => {
    if (!lastSync) return true
    return new Date(conversation.updatedAt).getTime() > lastSync.getTime()
  })

  let synced = 0
  await limitConcurrency(conversations, 5, async conversation => {
    await upsertConversationEmbeddings({
      tenantId: agent.tenantId,
      agentId: agent.id,
      conversationId: conversation.id,
      messages: conversation.messages ?? []
    })
    synced += 1
  })

  // Update agent's lastEmbeddingsSyncAt
  const syncTime = new Date().toISOString()
  const agentSnapshot = await adminDb
    .collectionGroup('agents')
    .where('id', '==', id)
    .limit(1)
    .get()

  if (!agentSnapshot.empty) {
    await agentSnapshot.docs[0].ref.update({
      lastEmbeddingsSyncAt: syncTime,
      updatedAt: syncTime
    })
  }

  return NextResponse.json({ synced, lastSync: syncTime })
}
