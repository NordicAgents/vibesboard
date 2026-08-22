import { notFound } from 'next/navigation'

import { getAgentById } from '@vibesboard/agents/server'
import { toPublicAgent } from '@vibesboard/contracts'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { hasValidAccessCookie } from '@/lib/access-gate'
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

  // Strip to the public-safe subset before it crosses the client boundary.
  const publicAgent = toPublicAgent(agent)

  if (agent.allowAnonymous) {
    return <PublicAgentExperience agent={publicAgent} embed />
  }

  return (
    <GatedWidgetPage
      agent={publicAgent}
      hasExistingAccess={await hasValidAccessCookie(agentId)}
    />
  )
}
