import { NextResponse } from 'next/server'

import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { getAgentBySlug } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import { listAgentConversations } from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const supabase = getServiceSupabaseClient()
  const agent = await getAgentBySlug(supabase, params.slug)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const externalId = ensureExternalSessionId()
  const conversations = await listAgentConversations(supabase, agent.id, {
    externalId
  })

  return NextResponse.json({ conversations })
}
