'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { useLocalStorage } from '@/lib/hooks/use-local-storage'
import { Button } from '@/components/ui/button'
import { IconArrowDown, IconArrowRight } from '@/components/ui/icons'
import { SidebarAgentItem } from '@/components/sidebar-agent-item'

interface SidebarAgentGroupProps {
  agent: VibeAgent
  conversations: VibeAgentConversation[]
}

export function SidebarAgentGroup({
  agent,
  conversations
}: SidebarAgentGroupProps) {
  const storageKey = `sidebar-agent:${agent.id}:expanded`
  const [expanded, setExpanded] = useLocalStorage<boolean>(storageKey, true)

  const items = useMemo(() => conversations ?? [], [conversations])

  return (
    <div className="space-y-1">
      <div className="relative">
        <SidebarAgentItem agent={agent} />
        {items.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={expanded ? 'Collapse conversations' : 'Expand conversations'}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? <IconArrowDown /> : <IconArrowRight />}
          </Button>
        ) : null}
      </div>

      {expanded && items.length ? (
        <div className="ml-6 space-y-1">
          {items.map(session => {
            const label =
              session.summary ||
              session.messages.at(-1)?.content?.slice(0, 80) ||
              'Conversation'
            return (
              <Link
                key={session.id}
                href={`/agents/${agent.id}?session=${session.id}`}
                className="block truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted/50"
                title={label}
              >
                {label}
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

