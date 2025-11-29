import { NextRequest, NextResponse } from 'next/server'

import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { getAgentBySlug } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import { listAgentConversations } from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = getServiceSupabaseClient()
  const agent = await getAgentBySlug(supabase, slug)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const externalId = await ensureExternalSessionId()
  const conversations = await listAgentConversations(supabase, agent.id, {
    externalId
  })

  return NextResponse.json({ conversations })
}
