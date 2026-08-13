import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
// Hybrid memory tables are RLS-denied for the app role (drizzle migration 0020)
// — the store must use the BYPASSRLS migrate client; access is guarded by
// canEditAgent and scoped by agent id.
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

// GET /api/agents/[id]/memory/mutations — list pending mutations
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!agent.memoryEnabled) return NextResponse.json({ mutations: [] })

  const engine = getEngine()
  const mutations = await engine.getPending({ scopeId: agent.id })
  return NextResponse.json({ mutations })
}
