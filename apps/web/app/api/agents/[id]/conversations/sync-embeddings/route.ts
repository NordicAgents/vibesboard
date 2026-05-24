import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { listAgentConversations } from '@vibesboard/agents/conversations'
import { setAgentEmbeddingsSyncedAt } from '@vibesboard/agents/db'
import {
  upsertConversationEmbeddings,
  deleteConversationEmbeddings
} from '@vibesboard/ai/embeddings'
import { limitConcurrency } from '@/lib/async-utils'
import { canEditAgent } from '@vibesboard/agents/permissions'

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

  const allConversations = await listAgentConversations(
    agent.tenantId,
    agent.id
  )

  const lastSync = agent.lastEmbeddingsSyncAt
    ? new Date(agent.lastEmbeddingsSyncAt)
    : null

  // Drop embeddings for non-visitor conversations (owner/test chats).
  const nonVisitor = allConversations.filter(
    conversation => !conversation.externalId
  )
  for (const conversation of nonVisitor) {
    await deleteConversationEmbeddings(agent.tenantId, conversation.id)
  }

  // (Re)embed visitor conversations updated since the last sync.
  const toSync = allConversations.filter(conversation => {
    if (!conversation.externalId) return false
    if (!lastSync) return true
    return new Date(conversation.updatedAt).getTime() > lastSync.getTime()
  })

  let synced = 0
  await limitConcurrency(toSync, 5, async conversation => {
    await upsertConversationEmbeddings({
      tenantId: agent.tenantId,
      agentId: agent.id,
      conversationId: conversation.id,
      messages: conversation.messages ?? []
    })
    synced += 1
  })

  const syncTime = new Date()
  await setAgentEmbeddingsSyncedAt(agent.id, syncTime)

  return NextResponse.json({ synced, lastSync: syncTime.toISOString() })
}
