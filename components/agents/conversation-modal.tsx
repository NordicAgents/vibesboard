'use client'

import * as React from 'react'
import { type VibeAgentConversation } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { ChatList } from '@/components/chat-list'
import { Separator } from '@/components/ui/separator'

interface ConversationModalProps {
  conversation: VibeAgentConversation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConversationModal({
  conversation,
  open,
  onOpenChange
}: ConversationModalProps) {
  if (!conversation) {
    return null
  }

  const summary = conversation.summary || 'Untitled conversation'
  const messages = conversation.messages || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden">
        <DialogHeader className="mb-4 border-b border-black-10 pb-4 dark:border-border">
          <DialogTitle className="font-switzer text-lg font-bold text-black-primary dark:text-foreground">
            {summary}
          </DialogTitle>
          <DialogDescription className="mt-1 font-switzer text-sm text-gray-secondary">
            Updated {formatDate(conversation.updatedAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {messages.length > 0 ? (
            <ChatList messages={messages} />
          ) : (
            <div className="py-8 text-center font-switzer text-sm text-gray-secondary">
              No messages in this conversation yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

