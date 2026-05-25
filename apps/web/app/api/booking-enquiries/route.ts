import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { getAgentForMember } from '@vibesboard/agents/server'
import { listEnquiriesForAgent } from '@vibesboard/booking-enquiries'

export const runtime = 'nodejs'

/**
 * GET /api/booking-enquiries?agentId=xxx
 * List all booking enquiries for an agent, newest first.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId)
    return NextResponse.json({ error: 'No active tenant' }, { status: 403 })

  const agentId = new URL(req.url).searchParams.get('agentId')
  if (!agentId)
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 })

  // Verify the agent belongs to this tenant to prevent cross-tenant data access
  const agent = await getAgentForMember(tenantId, agentId)
  if (!agent)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const enquiries = await listEnquiriesForAgent(tenantId, agentId, 100)

  return NextResponse.json({ enquiries })
}
