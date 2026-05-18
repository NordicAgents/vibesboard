import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { getAgentById } from '@vibesboard/agents/server'
import { mapConversationDoc } from '@vibesboard/agents/db'
import { summarizeConversation } from '@vibesboard/ai/summarize'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const { id, cid } = await params
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

  const docRef = adminDb
    .collection(Collections.conversations(agent.tenantId, agent.id))
    .doc(cid)

  const doc = await docRef.get()

  if (!doc.exists) {
    return new NextResponse('Not found', { status: 404 })
  }

  const data = doc.data()!
  if (data.agentId !== id) {
    return new NextResponse('Not found', { status: 404 })
  }

  const conversation = mapConversationDoc(data)
  let summary = conversation.summary ?? null
  let summaryGeneratedAt = conversation.summaryGeneratedAt ?? null

  if (!summary) {
    summary = await summarizeConversation(conversation.messages)
    summaryGeneratedAt = summary ? new Date().toISOString() : summaryGeneratedAt
  }

  const closedAt = new Date().toISOString()
  await docRef.update({
    closedAt,
    summary,
    summaryGeneratedAt,
    updatedAt: closedAt
  })

  return NextResponse.json({ ok: true, summary, closedAt })
}
