import { NextRequest, NextResponse } from 'next/server'

import { getAgentById } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent-cookies'
import { getConversation } from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; cid: string }> }
) {
  const { agentId, cid } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const tenantId = agent.tenantId!
  const externalId = await ensureExternalSessionId()
  const conversation = await getConversation(tenantId, agent.id, cid)

  if (!conversation || conversation.agentId !== agent.id) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (conversation.externalId !== externalId) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  return NextResponse.json({ conversation })
}
