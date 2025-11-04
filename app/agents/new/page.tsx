import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentBuilder } from '@/components/agents/agent-builder'

export const runtime = 'nodejs'

export default async function NewAgentPage() {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in?next=/agents/new')
  }

  return (
    <div className="container mx-auto flex-1 space-y-6 px-4 py-8">
      <div>
        <p className="text-sm uppercase text-muted-foreground">Create</p>
        <h1 className="text-3xl font-semibold">Build a new VibeAgent</h1>
      </div>
      <AgentBuilder userId={session.user.id} />
    </div>
  )
}
