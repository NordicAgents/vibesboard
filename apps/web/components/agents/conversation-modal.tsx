'use client'

import * as React from 'react'
import Textarea from 'react-textarea-autosize'
import { type Message } from '@vibesboard/contracts'
import { type VibeAgentConversation } from '@vibesboard/contracts'
import { formatDate, cn } from '@vibesboard/utils'
import { ChatList } from '@/components/chat-list'
import { Button } from '@/components/ui/button'
import { IconArrowLeft, IconSpinner } from '@/components/ui/icons'
import { useEnterSubmit } from '@/lib/hooks/use-enter-submit'
import { getConversationPreview } from '@vibesboard/agents/conversation-preview'
import { Play, Pause, Send, Trash2 } from 'lucide-react'

const HANDOFF_INDICATOR_PREFIX = '__handoff_indicator__'

const MARKER_PATTERNS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]',
  CHAT_COMPLETE_REGEX: /<!--CHAT_COMPLETE:\s*(\{[\s\S]*?\})\s*-->/g,
  SUGGESTIONS_REGEX: /<!--SUGGESTIONS:\s*(\{[\s\S]*?\})-->/g,
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
  agentId?: string
  agentName?: string
  canReply?: boolean
  canDelete?: boolean
  onConversationUpdate?: () => void
  onDelete?: () => void
}

export function ConversationView({
  conversation: initialConversation,
  onClose,
  agentId,
  agentName,
  canReply = false,
  canDelete = false,
  onConversationUpdate,
  onDelete
}: ConversationViewProps) {
  const [conversation, setConversation] = React.useState(initialConversation)
  const [input, setInput] = React.useState('')
  const [isSending, setIsSending] = React.useState(false)
  const [isToggling, setIsToggling] = React.useState(false)
  const { formRef, onKeyDown } = useEnterSubmit()
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const isChatwoot = !!conversation.externalId?.startsWith('chatwoot:')
  const handedOff = conversation.handedOff === true

  const summary = React.useMemo(
    () =>
      getConversationPreview(conversation.messages || [], conversation.summary),
    [conversation.messages, conversation.summary]
  )
  const messages = React.useMemo(
    () => cleanConversationMessages(conversation.messages || []),
    [conversation.messages]
  )

  // Sync when parent passes updated conversation
  React.useEffect(() => {
    setConversation(initialConversation)
  }, [initialConversation])

  // Poll for new messages when in handoff mode
  React.useEffect(() => {
    if (!canReply || !agentId || !handedOff) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/agents/${agentId}/conversations/${conversation.id}`
        )
        if (res.ok) {
          const data = await res.json()
          if (data.conversation) {
            setConversation(data.conversation)
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [canReply, agentId, handedOff, conversation.id])

  // Scroll to bottom when messages change
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSendReply = async () => {
    const text = input.trim()
    if (!text || !agentId || isSending) return

    setIsSending(true)
    // Optimistically add message
    const optimisticMsg: Message = {
      id: `pending-${Date.now()}`,
      role: 'assistant',
      content: text
    }
    setConversation(prev => ({
      ...prev,
      messages: [...(prev.messages || []), optimisticMsg]
    }))
    setInput('')

    try {
      const res = await fetch(
        `/api/agents/${agentId}/conversations/${conversation.id}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[handoff] Failed to send reply:', err)
        // Remove optimistic message on failure
        setConversation(prev => ({
          ...prev,
          messages: (prev.messages || []).filter(m => m.id !== optimisticMsg.id)
        }))
        setInput(text)
      } else {
        onConversationUpdate?.()
      }
    } catch (err) {
      console.error('[handoff] Error sending reply:', err)
      setConversation(prev => ({
        ...prev,
        messages: (prev.messages || []).filter(m => m.id !== optimisticMsg.id)
      }))
      setInput(text)
    } finally {
      setIsSending(false)
    }
  }

  const handleToggleHandoff = async () => {
    if (!agentId || isToggling) return

    setIsToggling(true)
    const action = handedOff ? 'resume' : 'stop'

    try {
      const res = await fetch(
        `/api/agents/${agentId}/conversations/${conversation.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        }
      )
      if (res.ok) {
        const data = await res.json()
        setConversation(prev => ({
          ...prev,
          handedOff: data.handedOff
        }))
        onConversationUpdate?.()
      }
    } catch (err) {
      console.error('[handoff] Error toggling handoff:', err)
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[#e4e3e3] bg-[#f7f7f5] px-4 py-3 dark:border-[#344348] dark:bg-[#222f30]">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="size-8 shrink-0 rounded-full p-0"
            onClick={onClose}
          >
            <IconArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-switzer text-base font-semibold text-[#222f30] dark:text-[#f5f8f7]">
              {summary}
            </h2>
            <p className="font-switzer text-xs text-[#6f7f80]">
              Updated {formatDate(conversation.updatedAt)}
            </p>
          </div>
          {/* Delete button */}
          {canDelete && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 rounded-full px-3 font-switzer text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
          {/* Stop/Resume button for Chatwoot conversations */}
          {canReply && isChatwoot && (
            <Button
              variant={handedOff ? 'outline' : 'destructive'}
              size="sm"
              className={cn(
                'shrink-0 gap-1.5 rounded-full px-3 font-switzer text-xs',
                handedOff
                  ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400'
                  : ''
              )}
              onClick={handleToggleHandoff}
              disabled={isToggling}
            >
              {isToggling ? (
                <IconSpinner className="size-3.5 animate-spin" />
              ) : handedOff ? (
                <Play className="size-3.5" />
              ) : (
                <Pause className="size-3.5" />
              )}
              {handedOff ? 'Resume Bot' : 'Pause Bot'}
            </Button>
          )}
        </div>
      </div>

      {/* Handoff banner */}
      {canReply && handedOff && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="mx-auto w-full max-w-4xl font-switzer text-xs text-amber-700 dark:text-amber-400">
            Bot paused — you are replying as a human agent
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f7f7f5] dark:bg-[#222f30]">
        <div className="mx-auto w-full max-w-4xl">
          {messages.length > 0 ? (
            <ChatList
              messages={messages}
              handoffIndicatorPrefix={HANDOFF_INDICATOR_PREFIX}
              variant="transcript"
              assistantLabel={agentName || 'Agent'}
              userLabel="Visitor"
              showMessageActions={false}
            />
          ) : (
            <div className="py-8 text-center font-switzer text-sm text-[#6f7f80]">
              No messages in this conversation yet.
            </div>
          )}
          <div ref={messagesEndRef} className="h-4 shrink-0" />
        </div>
      </div>

      {/* Reply input — shown when bot is paused */}
      {canReply && handedOff && (
        <div className="border-t border-[#e4e3e3] bg-[#f7f7f5] px-4 py-3 dark:border-[#344348] dark:bg-[#222f30]">
          <form
            ref={formRef}
            onSubmit={async e => {
              e.preventDefault()
              await handleSendReply()
            }}
            className="mx-auto flex w-full max-w-4xl items-end gap-2"
          >
            <Textarea
              tabIndex={0}
              onKeyDown={onKeyDown}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Reply to customer..."
              spellCheck={false}
              className="max-h-[200px] min-h-[44px] flex-1 resize-none rounded-xl border border-[#e4e3e3] bg-white px-4 py-3 font-switzer text-sm focus:border-accent-orange focus:outline-none focus:ring-1 focus:ring-accent-orange dark:border-[#344348] dark:bg-[#192425] dark:text-[#f5f8f7]"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || isSending}
              className="hover:bg-accent-orange/90 size-11 shrink-0 rounded-xl bg-accent-orange p-0 text-white disabled:opacity-50"
            >
              {isSending ? (
                <IconSpinner className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
