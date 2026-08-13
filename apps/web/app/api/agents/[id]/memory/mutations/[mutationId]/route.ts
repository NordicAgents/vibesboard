import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
// Hybrid memory tables are RLS-denied for the app role (drizzle migration 0020)
// — the store must use the BYPASSRLS migrate client; access is guarded by
// guardAgent and the scopeId check before approve/reject.
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { HybridEngram } from '@vibesboard/hybrid-memory'
import { PostgresHybridStore } from '@vibesboard/hybrid-memory/adapters/postgres'
import {
  OpenAILLMProvider,
  OpenAIEmbedder
} from '@vibesboard/hybrid-memory/adapters/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getEngine() {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  return new HybridEngram({
    store: new PostgresHybridStore(getMigrateDb()),
    llm: new OpenAILLMProvider({ apiKey }),
    embedder: new OpenAIEmbedder({ apiKey }),
    options: { autoApprove: false }
  })
}

async function guardAgent(userId: string, agentId: string) {
  const agent = await getAgentById(agentId)
  if (!agent)
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
  const canEdit = await canEditAgent({
    sessionUserId: userId,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit)
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  return { ok: true as const, agent }
}

// POST /api/agents/[id]/memory/mutations/[mutationId]
// body: { action: 'approve' | 'reject' }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mutationId: string }> }
) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const { id, mutationId } = await params
  const guard = await guardAgent(authResult.user.id, id)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const action = body?.action

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
      { status: 400 }
    )
  }

  const engine = getEngine()

  // Verify mutation belongs to this agent before acting
  const pending = await engine.getPending({ scopeId: id })
  const mutation = pending.find(m => m.id === mutationId)
  if (!mutation) {
    return NextResponse.json(
      { error: 'Mutation not found or already resolved' },
      { status: 404 }
    )
  }

  try {
    if (action === 'approve') {
      await engine.approve(mutationId)
    } else {
      await engine.reject(mutationId)
    }
    return NextResponse.json({ ok: true, action })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
