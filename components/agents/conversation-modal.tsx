'use client'

import * as React from 'react'
import { type Message } from 'ai'
import { type VibeAgentConversation } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { Button } from '@/components/ui/button'
import { IconArrowLeft } from '@/components/ui/icons'

const HANDOFF_INDICATOR_PREFIX = '__handoff_indicator__'

const MARKER_PATTERNS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]',
  CHAT_COMPLETE_REGEX: /<!--CHAT_COMPLETE:(\{.*?\})-->/g,
  SUGGESTIONS_REGEX: /<!--SUGGESTIONS:(\{[\s\S]*?\})-->/g,
  AGENT_HANDOFF_REGEX: /<!--AGENT_HANDOFF:(\{.*?\})-->/,
  HANDOFF_TO_AGENT_MARKER: /\[HANDOFF_TO_AGENT:[a-zA-Z0-9_-]+\]/g
}

function cleanConversationMessages(raw: Message[]): Message[] {
  const cleaned: Message[] = []

  for (const m of raw) {
    if (m.role === 'assistant' && m.content) {
      const handoffMatch = m.content.match(MARKER_PATTERNS.AGENT_HANDOFF_REGEX)

      let cleanedContent = m.content
        .replace(MARKER_PATTERNS.COLLECTION_COMPLETE, '')
        .replace(MARKER_PATTERNS.INFO_COMPLETE, '')
        .replace(MARKER_PATTERNS.CHAT_COMPLETE_REGEX, '')
        .replace(MARKER_PATTERNS.SUGGESTIONS_REGEX, '')
        .replace(MARKER_PATTERNS.AGENT_HANDOFF_REGEX, '')
        .replace(MARKER_PATTERNS.HANDOFF_TO_AGENT_MARKER, '')
        .trim()

      cleaned.push({ ...m, content: cleanedContent })

      if (handoffMatch) {
        try {
          const meta = JSON.parse(handoffMatch[1])
          cleaned.push({
            id: `${HANDOFF_INDICATOR_PREFIX}${m.id}`,
            role: 'system',
            content: meta.targetAgentName
          })
        } catch {
          // ignore
        }
      }
    } else {
      cleaned.push(m)
    }
  }

  return cleaned
}

interface ConversationViewProps {
  conversation: VibeAgentConversation
  onClose: () => void
}

export function ConversationView({
  conversation,
  onClose
}: ConversationViewProps) {
  const summary = conversation.summary || 'Untitled conversation'
  const rawMessages = conversation.messages || []
  const messages = React.useMemo(
    () => cleanConversationMessages(rawMessages),
    [rawMessages]
  )

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
            <ChatList
              messages={messages}
              handoffIndicatorPrefix={HANDOFF_INDICATOR_PREFIX}
            />
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
