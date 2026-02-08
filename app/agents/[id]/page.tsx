import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { getQrDataUrl } from '@/lib/qr'
import { AgentChatWithLayout } from '@/components/agents/agent-chat-with-layout'
import { canEditAgent } from '@/lib/agents/permissions'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

export const runtime = 'nodejs'

export default async function AgentPageAsChat({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const query = await searchParams
  const isConfigure = query.configure === 'true'
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const supabase = createServerComponentClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const { data: agentRow } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!agentRow) {
    notFound()
  }

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agentRow.user_id,
    tenantId: agentRow.tenant_id
  })

  const agent = mapAgentRow(agentRow)

  const conversationClient = canEdit ? getServiceSupabaseClient() : supabase

  const { data: convoRows } = await conversationClient
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', agent.id)
    .order('updated_at', { ascending: false })

  const conversations = (convoRows ?? []).map(mapConversationRow)
  const ownerConversations = conversations.filter(
    conversation => conversation.userId === session.user.id
  )
  const visitorConversations = canEdit
    ? conversations.filter(conversation => conversation.externalId)
    : []
  const lastSync = agent.lastEmbeddingsSyncAt
    ? new Date(agent.lastEmbeddingsSyncAt)
    : null
  const hasUnsyncedConversations = canEdit
    ? visitorConversations.some(conversation =>
        lastSync
          ? new Date(conversation.updatedAt).getTime() > lastSync.getTime()
          : true
      )
    : false

  const headersList = await headers()
  const rawProto = headersList.get('x-forwarded-proto')
  const protocol =
    (rawProto ? rawProto.split(',')[0]?.trim() : null) ??
    (headersList.get('host')?.startsWith('localhost') ? 'http' : 'https')
  const rawHost = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const host = rawHost ? rawHost.split(',')[0]?.trim() : null
  const origin =
    (protocol && host
      ? `${protocol}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  const shareUrl = `${origin}/a/${agent.agentUrl}`
  const qrDataUrl = await getQrDataUrl(shareUrl)

  return (
    <AgentChatWithLayout
      agent={agent}
      ownerId={session.user.id}
      ownerSessions={ownerConversations}
      visitorSessions={visitorConversations}
      hasUnsyncedConversations={hasUnsyncedConversations}
      share={{ url: shareUrl, qrDataUrl }}
      isConfigure={canEdit ? isConfigure : false}
      canEdit={canEdit}
    />
  )
}
