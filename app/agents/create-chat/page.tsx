import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentCreatorChat } from '@/components/agents/agent-creator-chat'

export const runtime = 'nodejs'

export default async function CreateAgentChatPage() {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in?next=/agents/create-chat')
  }

  return <AgentCreatorChat userId={session.user.id} />
}
