'use client'

import Link from 'next/link'

import { type VibeAgentConversation } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface AgentConversationListProps {
  agentId: string
  conversations: VibeAgentConversation[]
}

export function AgentConversationList({
  agentId,
  conversations
}: AgentConversationListProps) {
  if (!conversations.length) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No conversations yet.
        <div className="mt-3">
          <Button asChild>
            <Link href={`/agents/${agentId}/conversations/new`}>Start chat</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {conversations.map(conversation => (
        <Link
          key={conversation.id}
          href={`/agents/${agentId}/conversations/${conversation.id}`}
        >
          <Card className="p-4 hover:border-primary">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">
                  {conversation.summary ||
                    conversation.messages.at(-1)?.content.slice(0, 60) ||
                    'Conversation'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Updated {formatDate(conversation.updatedAt)}
                </p>
              </div>
              <span className="text-sm font-medium text-primary">Open</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}
