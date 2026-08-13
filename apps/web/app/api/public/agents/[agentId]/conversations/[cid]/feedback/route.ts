import { NextRequest, NextResponse } from 'next/server'
import { getAgentById } from '@vibesboard/agents/server'
import { ensureExternalSessionId } from '@/lib/agent-cookies'
import {
  getConversation,
  recordConversationFeedback
} from '@vibesboard/agents/conversations'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; cid: string }> }
) {
  const { agentId, cid } = await params

  const agent = await getAgentById(agentId)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const tenantId = agent.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: 'Invalid agent' }, { status: 400 })
  }

  const conversation = await getConversation(tenantId, agentId, cid)
  if (!conversation) {
    return NextResponse.json(
      { error: 'Conversation not found' },
      { status: 404 }
    )
  }

  // Only the visitor who owns the conversation may rate it. Without this,
  // anyone who learns an agentId + conversation id can write a rating and a
  // 500-char comment onto a stranger's conversation (password-gated agents
  // included) and the owner sees it as that visitor's feedback. Same check and
  // status as the GET sibling in ../route.ts. Fails closed: the cookie helper
  // always returns a non-empty id, so a conversation with no externalId (e.g.
  // WhatsApp) never matches.
  const externalId = await ensureExternalSessionId()
  if (conversation.externalId !== externalId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !['positive', 'negative'].includes(body.rating)) {
    return NextResponse.json(
      { error: 'Invalid rating. Must be "positive" or "negative".' },
      { status: 400 }
    )
  }

  await recordConversationFeedback(tenantId, cid, {
    rating: body.rating as 'positive' | 'negative',
    ...(body.comment && typeof body.comment === 'string'
      ? { comment: body.comment.slice(0, 500) }
      : {})
  })

  return NextResponse.json({ ok: true })
}
