'use client'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { WhatsAppInboxConversationDocument } from '@/lib/firestore-types'

interface ConversationListProps {
  conversations: WhatsAppInboxConversationDocument[]
  selectedPhone: string | null
  onSelect: (contactPhone: string) => void
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function ConversationList({
  conversations,
  selectedPhone,
  onSelect,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No conversations yet. Messages will appear here when customers contact you.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.map((convo) => {
        const isSelected = selectedPhone === convo.contactPhone
        return (
          <button
            key={convo.contactPhone}
            onClick={() => onSelect(convo.contactPhone)}
            className={cn(
              'flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors',
              isSelected
                ? 'border-l-2 border-l-accent-orange bg-accent/50'
                : 'hover:bg-accent/30'
            )}
          >
            {/* Avatar placeholder */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-muted-foreground">
              {(convo.contactProfileName || convo.contactPhone)?.[0]?.toUpperCase() || '?'}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {convo.contactProfileName || `+${convo.contactPhone}`}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(convo.lastMessageAt)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-muted-foreground">
                  {convo.lastMessagePreview || 'No messages'}
                </p>
                {convo.unreadCount > 0 && (
                  <Badge className="size-5 shrink-0 justify-center rounded-full bg-accent-orange p-0 text-[10px] text-white">
                    {convo.unreadCount > 99 ? '99+' : convo.unreadCount}
                  </Badge>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
