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
    <div className="flex flex-col gap-4">
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
      <div className="rounded-2xl border bg-muted p-5 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Welcome
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          You&apos;re now vibing with {agent.name}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Thanks for scanning their QR code. Drop your vibe below to start the
          conversation for everyone.
        </p>
      </div>
      <AgentChat
        agent={agent}
        endpoint={`/api/public/agents/${agent.agentUrl}/chat`}
      />
    </div>
  )
}
