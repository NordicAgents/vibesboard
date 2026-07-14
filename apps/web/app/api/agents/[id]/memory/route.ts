import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { getDb } from '@vibesboard/adapter-postgres/client'
import { PostgresHybridStore } from '@vibesboard/hybrid-memory/adapters/postgres'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/agents/[id]/memory — list stored memories for this agent (admin view)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const canEdit = await canEditAgent({ sessionUserId: authResult.user.id, agentOwnerId: agent.userId, tenantId: agent.tenantId })
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!agent.memoryEnabled) return NextResponse.json({ memories: [] })

  const store = new PostgresHybridStore(getDb())
  const memories = await store.listMemories({ scopeId: id })
  return NextResponse.json({ memories })
}
