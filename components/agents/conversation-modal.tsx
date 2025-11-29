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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col gap-0">
        <DialogHeader className="border-b border-black-10 dark:border-border pb-4 mb-4">
          <DialogTitle className="font-switzer text-lg font-bold text-black-primary dark:text-foreground">
            {summary}
          </DialogTitle>
          <DialogDescription className="font-switzer text-sm text-gray-secondary mt-1">
            Updated {formatDate(conversation.updatedAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {messages.length > 0 ? (
            <ChatList messages={messages} />
          ) : (
            <div className="py-8 text-center text-sm text-gray-secondary font-switzer">
              No messages in this conversation yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

