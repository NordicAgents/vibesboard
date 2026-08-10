import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { listAgentConversations } from '@vibesboard/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  // getAgentById is scoped by agent id only and reads through the BYPASSRLS
  // migrate role, so authentication alone would let any signed-in user read
  // another tenant's visitor transcripts.
  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const conversations = await listAgentConversations(agent.tenantId, agent.id)
  return NextResponse.json({ conversations })
}
