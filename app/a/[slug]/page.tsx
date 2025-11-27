import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

import { type Database } from '@/lib/db_types'
import { mapAgentRow } from '@/lib/agents/db'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'

export const runtime = 'nodejs'

export default async function PublicAgentPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const cookieStore = await cookies()
  const supabase = createServerComponentClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('agent_url', slug)
    .maybeSingle()

  if (!data) {
    notFound()
  }

  const agent = mapAgentRow(data)

  return (
    <div className="container mx-auto flex-1 px-4 py-6">
      {agent.allowAnonymous ? (
        <PublicAgentExperience agent={agent} />
      ) : (
        <div className="rounded-lg border p-8 text-center">
          <h1 className="text-2xl font-semibold">{agent.name}</h1>
          <p className="mt-2 text-muted-foreground">
            This agent requires an invitation or authenticated session. Please
            contact the owner for access.
          </p>
        </div>
      )}
    </div>
  )
}
