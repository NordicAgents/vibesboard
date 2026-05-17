'use client'

import { ArrowRight } from 'lucide-react'

interface ChatHandoffIndicatorProps {
  agentName: string
}

export function ChatHandoffIndicator({ agentName }: ChatHandoffIndicatorProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1.5 rounded-full bg-accent-orange/10 px-3 py-1 text-xs font-medium text-accent-orange">
        <ArrowRight className="size-3" />
        Transferred to {agentName}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
