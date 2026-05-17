'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { type VibeAgentConversation } from '@vibesboard/contracts'
import { getConversationPreview } from '@vibesboard/agents/conversation-preview'
import { formatDate } from '@vibesboard/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconClose } from '@/components/ui/icons'

interface AgentConversationListProps {
  agentId: string
  conversations: VibeAgentConversation[]
}

export function AgentConversationList({
  agentId,
  conversations
}: AgentConversationListProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(conversations[0]?.id ?? null)

  const selectedConversation = useMemo(
    () =>
      selectedConversationId
        ? conversations.find(conv => conv.id === selectedConversationId)
        : null,
    [conversations, selectedConversationId]
  )

  if (!conversations.length) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No conversations yet.
        <div className="mt-3">
          <Button asChild>
            <Link href={`/agents/${agentId}/conversations/new`}>
              Start chat
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="space-y-2 lg:w-1/2">
        {conversations.map(conversation => {
          const contentPreview = getConversationPreview(
            conversation.messages,
            conversation.summary
          )

          const isSelected = selectedConversationId === conversation.id

          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => setSelectedConversationId(conversation.id)}
              className="w-full text-left"
            >
              <Card
                className={`p-4 transition ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{contentPreview}</p>
                    <p className="text-sm text-muted-foreground">
                      Updated {formatDate(conversation.updatedAt)}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-primary">
                    {isSelected ? 'Viewing' : 'Preview'}
                  </span>
                </div>
              </Card>
            </button>
          )
        })}
      </div>
      <div className="lg:w-1/2">
        <Card className="h-full p-4">
          {selectedConversation ? (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {getConversationPreview(
                      selectedConversation.messages,
                      selectedConversation.summary,
                      'Conversation preview'
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDate(selectedConversation.updatedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close conversation preview"
                  onClick={() => setSelectedConversationId(null)}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
              <div className="max-h-[500px] space-y-3 overflow-y-auto pr-2">
                {selectedConversation.messages.length ? (
                  selectedConversation.messages.map((message, index) => (
                    <div
                      key={message.id ?? `${message.role}-${index}`}
                      className="rounded-md border bg-muted/40 p-3"
                    >
                      <p className="text-xs uppercase text-muted-foreground">
                        {message.role === 'assistant' ? 'Agent' : 'User'}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        {typeof message.content === 'string'
                          ? message.content
                          : ''}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No messages recorded.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a conversation to preview.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
