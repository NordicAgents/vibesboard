import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { revokeInviteCode } from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

// PATCH — revoke invite code
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; codeId: string }> }
) {
  const { id, codeId } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  await revokeInviteCode(agent.tenantId!, id, codeId)
  return NextResponse.json({ ok: true })
}
