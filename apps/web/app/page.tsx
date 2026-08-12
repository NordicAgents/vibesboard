import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { getAgents } from '@/app/actions'
import { LandingPage } from '@/components/landing/landing-page'

export const runtime = 'nodejs'

export default async function IndexPage() {
  const session = await auth()

  if (!session?.user) {
    return <LandingPage />
  }

  const agents = await getAgents(session.user.id)
  if (agents.length > 0) {
    redirect('/agents')
  } else {
    redirect('/agents/create-chat')
  }
}
