'use client'

import { useState } from 'react'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { AccessGateForm } from '@/components/agents/access-gate-form'
import type { VibeAgent } from '@vibesboard/contracts'

interface GatedAgentPageProps {
  agent: VibeAgent
  googleReviewPlaceId: string | null
  logoUrl: string | null
  hasExistingAccess: boolean
}

export function GatedAgentPage({
  agent,
  googleReviewPlaceId,
  logoUrl,
  hasExistingAccess
}: GatedAgentPageProps) {
  const [verified, setVerified] = useState(hasExistingAccess)

  if (verified) {
    return (
      <PublicAgentExperience
        agent={agent}
        googleReviewPlaceId={googleReviewPlaceId}
        logoUrl={logoUrl}
      />
    )
  }

  return (
    <AccessGateForm
      agentId={agent.id}
      agentName={agent.name}
      logoUrl={logoUrl}
      onVerified={() => setVerified(true)}
    />
  )
}
