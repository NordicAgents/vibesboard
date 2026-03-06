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
      <div className="sticky top-0 z-10 border-b border-[#E5E5E5] bg-[#FFFFFF]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[#FFFFFF]/75 dark:border-[#2A2A2A] dark:bg-[#1A1A1A]/95">
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
            <h2 className="truncate font-switzer text-base font-semibold text-[#1A1A1A] dark:text-[#F0F0F0]">
              {summary}
            </h2>
            <p className="font-switzer text-xs text-[#8A8A8A]">
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
            <div className="py-8 text-center font-switzer text-sm text-[#8A8A8A]">
              No messages in this conversation yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
