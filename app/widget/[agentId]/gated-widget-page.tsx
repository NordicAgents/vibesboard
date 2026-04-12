'use client'

import { useState } from 'react'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { AccessGateForm } from '@/components/agents/access-gate-form'
import type { VibeAgent } from '@/lib/types'

interface GatedWidgetPageProps {
  agent: VibeAgent
  hasExistingAccess: boolean
}

export function GatedWidgetPage({ agent, hasExistingAccess }: GatedWidgetPageProps) {
  const [verified, setVerified] = useState(hasExistingAccess)

  if (verified) {
    return <PublicAgentExperience agent={agent} embed />
  }

  return (
    <AccessGateForm
      agentId={agent.id}
      agentName={agent.name}
      embed
      onVerified={() => setVerified(true)}
    />
  )
}
