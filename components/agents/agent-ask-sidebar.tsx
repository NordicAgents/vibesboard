'use client'

import Link from 'next/link'

import { type VibeAgentConversation } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface AgentAskSidebarProps {
  sessions: VibeAgentConversation[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onNewChat: () => void
}

export function AgentAskSidebar({
  sessions,
  activeId,
  onSelect,
  onNewChat
}: AgentAskSidebarProps) {
  return (
    <div className="flex size-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Ask AI</p>
          <h2 className="text-lg font-semibold">Owner chats</h2>
        </div>
        <Button size="sm" onClick={onNewChat}>New chat</Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {sessions.length ? (
          sessions.map(session => {
            const isActive = session.id === activeId
            const label =
              session.summary ||
              session.messages.at(-1)?.content?.slice(0, 80) ||
              'Conversation'
            return (
              <button
                type="button"
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                  isActive ? 'border-primary bg-primary/5' : 'hover:border-primary'
                }`}
              >
                <p className="line-clamp-2 font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                  Updated {formatDate(session.updatedAt)}
                </p>
              </button>
            )
          })
        ) : (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            No owner chats yet. Start one to pin insights here.
          </p>
        )}
      </div>
      <Button variant="ghost" asChild>
        <Link href="/agents">Back to agents</Link>
      </Button>
    </div>
  )
}
