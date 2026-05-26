'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MessageWindowIndicator } from './message-window-indicator'
import {
  Send,
  Check,
  CheckCheck,
  AlertCircle,
  Bot,
  Pause,
  Play,
  UserPlus
} from 'lucide-react'
import { cn } from '@vibesboard/utils'
import toast from 'react-hot-toast'
import type {
  InstagramInboxMessageDocument,
  InstagramInboxConversationDocument
} from '@vibesboard/contracts'

interface MessageThreadProps {
  tenantId: string
  accountId: string
  conversation: InstagramInboxConversationDocument
  messages: InstagramInboxMessageDocument[]
  onMessageSent: () => void
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'sent':
      return <Check className="size-3 text-muted-foreground" />
    case 'delivered':
      return <CheckCheck className="size-3 text-muted-foreground" />
    case 'read':
      return <CheckCheck className="size-3 text-blue-500" />
    case 'failed':
      return <AlertCircle className="size-3 text-red-500" />
    default:
      return null
  }
}

function getMessageText(msg: InstagramInboxMessageDocument): string {
  if (msg.text) return msg.text
  switch (msg.type) {
    case 'image':
      return '[Image]'
    case 'video':
      return '[Video]'
    case 'story_mention':
      return 'Mentioned you in their story'
    case 'story_reply':
      return '[Story Reply]'
    case 'media_share':
      return 'Shared a post'
    default:
      return `[${msg.type}]`
  }
}

export function MessageThread({
  tenantId,
  accountId,
  conversation,
  messages,
  onMessageSent
}: MessageThreadProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const windowOpen =
    conversation.windowExpiresAt &&
    new Date(conversation.windowExpiresAt) > new Date()

  const hasAgent = !!conversation.assignedAgentId
  const agentPaused = !!conversation.agentPaused
  const agentHandedOff = !!conversation.agentHandedOff

  const patchConversation = async (updates: Record<string, any>) => {
    await fetch(
      `/api/tenants/${tenantId}/instagram-inbox/accounts/${accountId}/conversations/${conversation.contactIgsid}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      }
    )
    onMessageSent() // refresh data
  }

  const displayName = conversation.contactUsername
    ? `@${conversation.contactUsername}`
    : conversation.contactName || conversation.contactIgsid

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/instagram-inbox/accounts/${accountId}/conversations/${conversation.contactIgsid}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed })
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to send message')
      }

      setText('')
      onMessageSent()
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">{displayName}</h3>
          {conversation.contactUsername && conversation.contactName && (
            <p className="text-xs text-muted-foreground">
              {conversation.contactName}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasAgent && !agentHandedOff && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => patchConversation({ agentPaused: !agentPaused })}
            >
              {agentPaused ? (
                <>
                  <Play className="size-3" />
                  Resume Agent
                </>
              ) : (
                <>
                  <Pause className="size-3" />
                  Pause Agent
                </>
              )}
            </Button>
          )}
          {agentHandedOff && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-accent-orange"
              onClick={() =>
                patchConversation({ agentHandedOff: false, agentPaused: false })
              }
            >
              <UserPlus className="size-3" />
              Re-assign Agent
            </Button>
          )}
          <MessageWindowIndicator
            windowExpiresAt={conversation.windowExpiresAt}
          />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No messages in this conversation yet.
            </p>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={cn(
                'flex',
                msg.direction === 'outbound' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[70%] rounded-2xl px-4 py-2',
                  msg.direction === 'outbound'
                    ? 'rounded-br-md bg-accent-orange/10 text-foreground'
                    : 'rounded-bl-md bg-secondary text-foreground'
                )}
              >
                {msg.sentBy?.startsWith('agent:') && (
                  <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-accent-orange">
                    <Bot className="size-3" />
                    {msg.sentByAgentName || 'AI Agent'}
                  </span>
                )}
                <p className="whitespace-pre-wrap text-sm">
                  {getMessageText(msg)}
                </p>
                <div
                  className={cn(
                    'mt-1 flex items-center gap-1',
                    msg.direction === 'outbound'
                      ? 'justify-end'
                      : 'justify-start'
                  )}
                >
                  <span className="text-[10px] text-muted-foreground">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                  {msg.direction === 'outbound' && (
                    <StatusIcon status={msg.status} />
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Handoff banner */}
      {agentHandedOff && (
        <div className="flex items-center justify-between border-t border-amber-200 bg-amber-50 px-4 py-2">
          <p className="text-xs text-amber-800">
            AI Agent handed off this conversation.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-accent-orange"
            onClick={() =>
              patchConversation({ agentHandedOff: false, agentPaused: false })
            }
          >
            Re-assign Agent
          </Button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border p-4">
        {windowOpen ? (
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="min-h-[44px] max-h-32 resize-none"
              rows={1}
              maxLength={1000}
              disabled={sending}
            />
            <Button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              size="icon"
              className="size-11 shrink-0"
            >
              <Send className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="rounded-lg bg-secondary/50 px-4 py-3 text-center">
            <p className="text-sm text-muted-foreground">
              The 24-hour messaging window has expired. You can only reply
              within 24 hours of the customer&apos;s last message.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
