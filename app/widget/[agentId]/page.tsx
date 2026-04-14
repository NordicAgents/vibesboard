import { notFound } from 'next/navigation'

import { getAgentById } from '@/lib/agents/server'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { hasValidAccessCookie } from '@/lib/agent/access-gate'
import { GatedWidgetPage } from './gated-widget-page'

export const runtime = 'nodejs'

export default async function WidgetPage({
  params
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    notFound()
  }

  if (agent.allowAnonymous) {
    return <PublicAgentExperience agent={agent} embed />
  }

  return (
    <GatedWidgetPage
      agent={agent}
      hasExistingAccess={await hasValidAccessCookie(agentId)}
    />
  )
}
