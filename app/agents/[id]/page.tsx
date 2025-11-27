import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { getQrDataUrl } from '@/lib/qr'
import { AgentChatWithLayout } from '@/components/agents/agent-chat-with-layout'

export const runtime = 'nodejs'

export default async function AgentPageAsChat({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!agentRow) {
    notFound()
  }

  const agent = mapAgentRow(agentRow)

  const { data: convoRows } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', agent.id)
    .order('updated_at', { ascending: false })

  const conversations = (convoRows ?? []).map(mapConversationRow)
  const ownerConversations = conversations.filter(
    conversation => conversation.userId === session.user.id
  )

  const headersList = headers()
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
      share={{ url: shareUrl, qrDataUrl }}
    />
  )
}
