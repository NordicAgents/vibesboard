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
    <div className="flex flex-1 flex-col items-stretch justify-center overflow-hidden px-3 py-3 sm:items-center sm:px-6 sm:py-8">
      {agent.allowAnonymous ? (
        <PublicAgentExperience agent={agent} />
      ) : (
        <div className="mx-auto w-full max-w-lg rounded-2xl border border-border/50 p-8 text-center shadow-lg">
          <h1 className="text-2xl font-semibold tracking-tight">
            {agent.name}
          </h1>
          <p className="mt-2 text-muted-foreground">
            This agent requires an invitation or authenticated session. Please
            contact the owner for access.
          </p>
        </div>
      )}
    </div>
  )
}
