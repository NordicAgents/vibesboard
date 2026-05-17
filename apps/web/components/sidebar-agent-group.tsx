'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { type VibeAgent, type VibeAgentConversation } from '@vibesboard/contracts'
import { useLocalStorage } from '@/lib/hooks/use-local-storage'
import { Button } from '@/components/ui/button'
import { IconArrowDown, IconArrowRight } from '@/components/ui/icons'
import { SidebarAgentItem } from '@/components/sidebar-agent-item'
import { getConversationPreview } from '@vibesboard/agents/conversation-preview'
import { cn } from '@vibesboard/utils'

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
    <div className="space-y-0.5">
      <div className="relative">
        <SidebarAgentItem agent={agent} />
        {items.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={
              expanded ? 'Collapse conversations' : 'Expand conversations'
            }
            className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#445e5f] dark:text-[#445e5f] dark:hover:bg-[#344348] dark:hover:text-[#6f7f80]"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? (
              <IconArrowDown className="size-3" />
            ) : (
              <IconArrowRight className="size-3" />
            )}
          </Button>
        ) : null}
      </div>

      {expanded && items.length ? (
        <div className="ml-5 space-y-0.5 overflow-hidden border-l border-[#e4e3e3] pl-2 dark:border-[#344348]">
          {items.map(session => {
            const label = getConversationPreview(
              session.messages,
              session.summary
            )
            return (
              <Link
                key={session.id}
                href={`/agents/${agent.id}?session=${session.id}`}
                className={cn(
                  'block truncate rounded-md px-2 py-1.5 text-sm transition-colors duration-150',
                  'text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#445e5f]',
                  'dark:text-[#445e5f] dark:hover:bg-[#344348] dark:hover:text-[#6f7f80]'
                )}
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
