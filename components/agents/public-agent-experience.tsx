'use client'

import { useRouter } from 'next/navigation'

import { type VibeAgent } from '@/lib/types'
import { AgentChat } from '@/components/agent-chat'
import { Button } from '@/components/ui/button'
import { IconClose } from '@/components/ui/icons'

interface PublicAgentExperienceProps {
  agent: VibeAgent
}

export function PublicAgentExperience({ agent }: PublicAgentExperienceProps) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push('/')}
          title="Close"
        >
          <IconClose className="mr-2" /> Close
        </Button>
      </div>
      <AgentChat
        agent={agent}
        endpoint={`/api/public/agents/${agent.agentUrl}/chat`}
      />
    </div>
  )
}
