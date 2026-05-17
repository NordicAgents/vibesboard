import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentCreatorChat } from '@/components/agents/agent-creator-chat'
import { nanoid } from '@/lib/utils'

export const runtime = 'nodejs'

export default async function CreateAgentChatPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in?next=/agents/create-chat')
  }

  return (
    <AgentCreatorChat
      userId={session.user.id}
      initialChatId={`agent-creator-${nanoid()}`}
    />
  )
}
