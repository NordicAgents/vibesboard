import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentCreatorChat } from '@/components/agents/agent-creator-chat'

export const runtime = 'nodejs'

export default async function IndexPage() {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in?next=/')
  }

  return <AgentCreatorChat />
}
