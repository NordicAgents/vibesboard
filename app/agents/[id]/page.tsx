import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow } from '@/lib/agents/db'
import { AgentChat } from '@/components/agent-chat'

export const runtime = 'nodejs'

export default async function AgentPageAsChat({
  params
}: {
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

  const { data: agentRow } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!agentRow) {
    notFound()
  }

  const agent = mapAgentRow(agentRow)

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <AgentChat agent={agent} endpoint={`/api/agents/${agent.id}/chat`} />
    </div>
  )
}
