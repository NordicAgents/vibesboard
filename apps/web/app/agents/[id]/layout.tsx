import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { getAgentById } from '@vibesboard/agents/server'
import { AgentPageShell } from '@/components/agents/agent-page-shell'

export const runtime = 'nodejs'

export default async function AgentSectionLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const agent = await getAgentById(id)

  if (!agent) {
    notFound()
  }

  return <AgentPageShell>{children}</AgentPageShell>
}
