import { NextResponse } from 'next/server'

import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { getAgentBySlug } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import { getConversation } from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: { slug: string; cid: string } }
) {
  const supabase = getServiceSupabaseClient()
  const agent = await getAgentBySlug(supabase, params.slug)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const externalId = ensureExternalSessionId()
  const conversation = await getConversation(supabase, params.cid)

  if (!conversation || conversation.agentId !== agent.id) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (conversation.externalId !== externalId) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  return NextResponse.json({ conversation })
}
