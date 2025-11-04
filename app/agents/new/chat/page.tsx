import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentCreatorChat } from '@/components/agents/agent-creator-chat'

export const runtime = 'nodejs'

export default async function NewAgentChatPage() {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in?next=/agents/new/chat')
  }

  return (
    <div className="container mx-auto flex-1 space-y-6 px-4 py-8">
      <AgentCreatorChat />
    </div>
  )
}

