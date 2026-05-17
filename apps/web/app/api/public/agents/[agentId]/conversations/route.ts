import { NextRequest, NextResponse } from 'next/server'

import { getAgentById } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import { listAgentConversations } from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const tenantId = agent.tenantId!
  const externalId = await ensureExternalSessionId()
  const conversations = await listAgentConversations(tenantId, agent.id, {
    externalId
  })

  return NextResponse.json({ conversations })
}
