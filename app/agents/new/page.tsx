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
    <div className="mx-auto max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
      <div className="animate-fade-slide-in">
        <p className="label-caps mb-1">Create</p>
        <h1 className="font-serif text-2xl font-normal text-[#1A1915] dark:text-[#E8E3D8] sm:text-3xl">
          Build a new Agent
        </h1>
      </div>
      <AgentBuilder userId={session.user.id} />
    </div>
  )
}
