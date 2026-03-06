import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentBuilder } from '@/components/agents/agent-builder'

export const runtime = 'nodejs'

export default async function NewAgentPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in?next=/agents/new')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <div className="animate-fade-slide-in">
          <p className="label-caps mb-1">Create</p>
          <h1 className="font-sans text-2xl font-normal text-[#1A1A1A] dark:text-[#F0F0F0] sm:text-3xl">
            Build a new Agent
          </h1>
        </div>
        <AgentBuilder userId={session.user.id} />
      </div>
    </div>
  )
}
