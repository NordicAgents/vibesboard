import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, mapConversationRow } from '@/lib/agents/db'
import { getQrDataUrl } from '@/lib/qr'
import { AgentPageShell } from '@/components/agents/agent-page-shell'

export const runtime = 'nodejs'

export default async function AgentSectionLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const supabase = createServerComponentClient<Database>({
    cookies: () => cookieStore
  })

  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!data) {
    notFound()
  }

  const agent = mapAgentRow(data)
  const { data: convoRows } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', agent.id)
    .order('updated_at', { ascending: false })

  const conversations = (convoRows ?? []).map(mapConversationRow)

  const headersList = headers()
  const protocol =
    headersList.get('x-forwarded-proto') ??
    (headersList.get('host')?.startsWith('localhost') ? 'http' : 'https')
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const origin =
    (protocol && host
      ? `${protocol}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  const shareUrl = `${origin}/a/${agent.agentUrl}`
  const qrDataUrl = await getQrDataUrl(shareUrl)

  return (
    <AgentPageShell
      agent={agent}
      share={{ url: shareUrl, qrDataUrl }}
      conversations={conversations}
    >
      {children}
    </AgentPageShell>
  )
}
