import { NextRequest, NextResponse } from 'next/server'
import { getAgentById } from '@vibesboard/agents/server'
import { getConversation } from '@vibesboard/agents/conversations'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'

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

  const body = await req.json().catch(() => null)
  if (!body || !['positive', 'negative'].includes(body.rating)) {
    return NextResponse.json(
      { error: 'Invalid rating. Must be "positive" or "negative".' },
      { status: 400 }
    )
  }

  const feedback = {
    rating: body.rating as 'positive' | 'negative',
    ...(body.comment && typeof body.comment === 'string'
      ? { comment: body.comment.slice(0, 500) }
      : {}),
    createdAt: new Date().toISOString()
  }

  const collPath = Collections.conversations(tenantId, agentId)
  await adminDb.collection(collPath).doc(cid).update({ feedback })

  return NextResponse.json({ ok: true })
}
