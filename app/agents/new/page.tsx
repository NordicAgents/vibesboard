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
    <div className="container mx-auto flex-1 space-y-6 bg-beige-bg px-4 py-8 dark:bg-background">
      <div>
        <p className="font-switzer text-sm uppercase tracking-wider text-gray-secondary">Create</p>
        <h1 className="font-switzer text-2xl font-bold text-black-primary sm:text-3xl dark:text-foreground">Build a new VibeAgent</h1>
      </div>
      <AgentBuilder userId={session.user.id} />
    </div>
  )
}
