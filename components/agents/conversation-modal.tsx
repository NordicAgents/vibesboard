'use client'

import * as React from 'react'
import { type VibeAgentConversation } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { Button } from '@/components/ui/button'
import { IconArrowLeft } from '@/components/ui/icons'

interface ConversationViewProps {
  conversation: VibeAgentConversation
  onClose: () => void
}

export function ConversationView({
  conversation,
  onClose
}: ConversationViewProps) {
  const summary = conversation.summary || 'Untitled conversation'
  const messages = conversation.messages || []

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#e4e3e3] bg-[#f7f7f5]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[#f7f7f5]/75 dark:border-[#344348] dark:bg-[#222f30]/95">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="size-8 shrink-0 rounded-full p-0"
            onClick={onClose}
          >
            <IconArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <div className="min-w-0">
            <h2 className="truncate font-switzer text-base font-semibold text-[#222f30] dark:text-[#f5f8f7]">
              {summary}
            </h2>
            <p className="font-switzer text-xs text-[#6f7f80]">
              Updated {formatDate(conversation.updatedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl">
          {messages.length > 0 ? (
            <ChatList messages={messages} />
          ) : (
            <div className="py-8 text-center font-switzer text-sm text-[#6f7f80]">
              No messages in this conversation yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
