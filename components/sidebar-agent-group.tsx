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

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

const toConversationLabel = (value?: string | null) => {
  const cleaned = (value ?? '')
    .replace(UUID_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'Conversation'
  if (cleaned.length <= 90) return cleaned

  const truncated = cleaned.slice(0, 90)
  const lastWordBoundary = truncated.lastIndexOf(' ')

  if (lastWordBoundary > 48) {
    return `${truncated.slice(0, lastWordBoundary)}…`
  }

  return `${truncated}…`
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
            aria-label={
              expanded ? 'Collapse conversations' : 'Expand conversations'
            }
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
            const label = toConversationLabel(
              session.summary || session.messages.at(-1)?.content
            )
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
