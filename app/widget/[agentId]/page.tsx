import { notFound } from 'next/navigation'

import { getAgentById } from '@/lib/agents/server'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'

export const runtime = 'nodejs'

export default async function WidgetPage({
  params
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent || !agent.allowAnonymous) {
    notFound()
  }

  return (
    <PublicAgentExperience agent={agent} embed />
  )
}
