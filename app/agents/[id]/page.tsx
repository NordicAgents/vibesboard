import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow } from '@/lib/agents/db'
import { AgentDashboard } from '@/components/agents/agent-dashboard'
import { getQrDataUrl } from '@/lib/qr'

export const runtime = 'nodejs'

export default async function AgentDashboardPage({
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
  const origin =
    headers().get('origin') ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000'
  const shareUrl = `${origin}/a/${agent.agentUrl}`
  const qrDataUrl = await getQrDataUrl(shareUrl)

  return (
    <div className="container mx-auto flex-1 space-y-6 px-4 py-8">
      <AgentDashboard agent={agent} share={{ url: shareUrl, qrDataUrl }} />
    </div>
  )
}
