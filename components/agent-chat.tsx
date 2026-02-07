'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChat, type Message } from 'ai/react'

import { type AgentMode, type VibeAgent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { EmptyScreen } from '@/components/empty-screen'
import { nanoid } from '@/lib/utils'

// Completion signal markers (must match server-side)
const COMPLETION_MARKERS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]',
  CHAT_COMPLETE_REGEX: /<!--CHAT_COMPLETE:(\{.*?\})-->/
}

interface AgentChatProps {
  agent: VibeAgent
  endpoint: string
  conversationId?: string
  initialMessages?: Message[]
  className?: string
  onChatComplete?: () => void
}

export function AgentChat({
  agent,
  endpoint,
  conversationId: initialConversationId,
  initialMessages,
  className,
  onChatComplete
}: AgentChatProps) {
  const [conversationId, setConversationId] = useState<string | undefined>(
    initialConversationId
  )
  const [agentMode, setAgentMode] = useState<AgentMode>(
    agent.mode || 'provider'
  )
  const [maxMessages, setMaxMessages] = useState<number | null>(
    agent.maxMessages ?? null
  )
  const [isChatComplete, setIsChatComplete] = useState(false)

  const chatKey = useMemo(
    () => initialConversationId ?? nanoid(),
    [initialConversationId]
  )
  const defaultInitialMessages: Message[] = useMemo(
    () => [
      {
        id: nanoid(),
        role: 'assistant',
        content: agent.greetingText || 'Hi How can i help you today'
      }
    ],
    [chatKey, agent.greetingText]
  )
  const messagesToUse = useMemo(
    () =>
      initialMessages && initialMessages.length > 0
        ? initialMessages
        : defaultInitialMessages,
    [initialMessages, defaultInitialMessages]
  )

  // Check for completion signals in messages
  const checkForCompletion = useCallback(
    (messagesArr: Message[]) => {
      // Count user messages
      const userMessageCount = messagesArr.filter(m => m.role === 'user').length

      // Check max messages threshold
      if (maxMessages && userMessageCount >= maxMessages) {
        setIsChatComplete(true)
        return
      }

      // Check last assistant message for completion markers
      const lastAssistantMessage = [...messagesArr]
        .reverse()
        .find(m => m.role === 'assistant')

      if (lastAssistantMessage?.content) {
        const content = lastAssistantMessage.content
        if (
          content.includes(COMPLETION_MARKERS.COLLECTION_COMPLETE) ||
          content.includes(COMPLETION_MARKERS.INFO_COMPLETE) ||
          COMPLETION_MARKERS.CHAT_COMPLETE_REGEX.test(content)
        ) {
          setIsChatComplete(true)
        }
      }
    },
    [maxMessages]
  )

  const {
    messages: rawMessages,
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
    initialMessages: messagesToUse,
    onResponse(response: Response) {
      const headerId = response.headers.get('x-conversation-id')
      if (headerId) {
        setConversationId(headerId)
      }
      // Get agent mode from header
      const modeHeader = response.headers.get(
        'x-agent-mode'
      ) as AgentMode | null
      if (modeHeader) {
        setAgentMode(modeHeader)
      }
      // Get max messages from header
      const maxMsgsHeader = response.headers.get('x-max-messages')
      if (maxMsgsHeader) {
        setMaxMessages(parseInt(maxMsgsHeader, 10) || null)
      }
    },
    onFinish(_message) {
      // Completion detection is handled in useEffect
    }
  })

  // Clean completion markers from messages for display
  const messages = useMemo(() => {
    return rawMessages.map(m => {
      if (m.role === 'assistant' && m.content) {
        const cleanedContent = m.content
          .replace(COMPLETION_MARKERS.COLLECTION_COMPLETE, '')
          .replace(COMPLETION_MARKERS.INFO_COMPLETE, '')
          .replace(COMPLETION_MARKERS.CHAT_COMPLETE_REGEX, '')
          .trim()
        if (cleanedContent !== m.content) {
          return { ...m, content: cleanedContent }
        }
      }
      return m
    })
  }, [rawMessages])

  // Check for completion whenever messages change (use rawMessages to detect markers)
  useEffect(() => {
    if (!isLoading && rawMessages.length > 0) {
      checkForCompletion(rawMessages)
    }
  }, [rawMessages, isLoading, checkForCompletion])

  const handleChatComplete = useCallback(() => {
    onChatComplete?.()
  }, [onChatComplete])

  return (
    <div className={cn('flex flex-1 flex-col', className)}>
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
        isChatComplete={isChatComplete}
        agentMode={agentMode}
        agentName={agent.name}
        onChatComplete={handleChatComplete}
      />
    </div>
  )
}
