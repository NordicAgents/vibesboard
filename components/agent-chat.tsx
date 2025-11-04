'use client'

import { useMemo, useState } from 'react'
import { useChat, type Message } from 'ai/react'

import { type VibeAgent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { EmptyScreen } from '@/components/empty-screen'
import { nanoid } from '@/lib/utils'

interface AgentChatProps {
  agent: VibeAgent
  endpoint: string
  conversationId?: string
  initialMessages?: Message[]
  className?: string
  showNewChatButton?: boolean
}

export function AgentChat({
  agent,
  endpoint,
  conversationId: initialConversationId,
  initialMessages,
  className,
  showNewChatButton = true
}: AgentChatProps) {
  const [conversationId, setConversationId] = useState<string | undefined>(
    initialConversationId
  )
  const chatKey = useMemo(
    () => initialConversationId ?? nanoid(),
    [initialConversationId]
  )
  const {
    messages,
    append,
    reload,
    stop,
    isLoading,
    input,
    setInput
  } = useChat({
    id: chatKey,
    api: endpoint,
    body: {
      conversationId
    },
    initialMessages,
    onResponse(response) {
      const headerId = response.headers.get('x-conversation-id')
      if (headerId) {
        setConversationId(headerId)
      }
    }
  })

  return (
    <div className={cn('flex flex-1 flex-col', className)}>
      <div className="border-b bg-background p-4">
        <p className="text-sm uppercase text-muted-foreground">Chatting with</p>
        <h1 className="text-2xl font-semibold">{agent.name}</h1>
        <p className="text-sm text-muted-foreground">
          /a/{agent.agentUrl}
        </p>
      </div>
      <div className="flex-1 pb-36 pt-4">
        {messages.length ? (
          <>
            <ChatList messages={messages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>
      <ChatPanel
        id={conversationId}
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
        showNewChatButton={showNewChatButton}
      />
    </div>
  )
}
