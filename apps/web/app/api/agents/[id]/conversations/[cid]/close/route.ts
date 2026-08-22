import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import {
  getConversation,
  closeConversation
} from '@vibesboard/agents/conversations'
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

  const conversation = await getConversation(agent.tenantId, id, cid)
  if (!conversation) {
    return new NextResponse('Not found', { status: 404 })
  }

  let summary = conversation.summary ?? null
  if (!summary) {
    summary = await summarizeConversation(
      conversation.messages,
      agent?.tenantId
    )
  }

  const closedAt = new Date().toISOString()
  await closeConversation(agent.tenantId, id, cid, summary)

  return NextResponse.json({ ok: true, summary, closedAt })
}
