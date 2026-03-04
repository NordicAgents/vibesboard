'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  CHAT_COMPLETE_REGEX: /<!--CHAT_COMPLETE:(\{.*?\})-->/,
  SUGGESTIONS_REGEX: /<!--SUGGESTIONS:(\{[\s\S]*?\})-->/g
}

interface AgentChatProps {
  agent: VibeAgent
  endpoint: string
  conversationId?: string
  initialMessages?: Message[]
  className?: string
  onChatComplete?: (messages?: Message[]) => void
  agentAvatarGradient?: string
  agentAvatarInitial?: string
  googleReviewPlaceId?: string | null
}

export function AgentChat({
  agent,
  endpoint,
  conversationId: initialConversationId,
  initialMessages,
  className,
  onChatComplete,
  agentAvatarGradient = 'from-violet-400 to-purple-500',
  agentAvatarInitial = 'A',
  googleReviewPlaceId
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
  const scrollRef = useRef<HTMLDivElement>(null)

  const quickSuggestionsMode = agent.quickSuggestionsMode ?? 'off'
  const quickSuggestionsCount = agent.quickSuggestionsCount ?? 4

  const chatKey = useMemo(
    () => initialConversationId ?? nanoid(),
    [initialConversationId]
  )
  const defaultInitialMessages: Message[] = useMemo(
    () => [
      {
        id: nanoid(),
        role: 'assistant',
        content: agent.greetingText || 'Hi! How can I help you today?'
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
      const userMessageCount = messagesArr.filter(m => m.role === 'user').length

      if (maxMessages && userMessageCount >= maxMessages) {
        setIsChatComplete(true)
        return
      }

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
      const modeHeader = response.headers.get(
        'x-agent-mode'
      ) as AgentMode | null
      if (modeHeader) {
        setAgentMode(modeHeader)
      }
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
          .replace(COMPLETION_MARKERS.SUGGESTIONS_REGEX, '')
          .trim()
        if (cleanedContent !== m.content) {
          return { ...m, content: cleanedContent }
        }
      }
      return m
    })
  }, [rawMessages])

  const quickSuggestions = useMemo(() => {
    if (quickSuggestionsMode === 'off') return []
    if (isLoading || isChatComplete) return []
    if (input.trim().length) return []

    const lastAssistant = [...rawMessages]
      .reverse()
      .find(m => m.role === 'assistant' && typeof m.content === 'string')

    const content = lastAssistant?.content ?? ''
    const match = content.match(/<!--SUGGESTIONS:(\{[\s\S]*?\})-->/)
    if (!match) return []

    let parsed: unknown = null
    try {
      parsed = JSON.parse(match[1])
    } catch {
      return []
    }

    const suggestionsRaw = Array.isArray((parsed as any)?.suggestions)
      ? ((parsed as any).suggestions as unknown[])
      : []

    const seen = new Set<string>()
    const suggestions: string[] = []
    for (const entry of suggestionsRaw) {
      if (typeof entry !== 'string') continue
      const value = entry.trim()
      if (!value) continue
      if (value.length > 80) continue
      if (seen.has(value)) continue
      seen.add(value)
      suggestions.push(value)
      if (suggestions.length >= quickSuggestionsCount) break
    }

    if (suggestions.length < 3) return []

    if (quickSuggestionsMode === 'always') {
      return suggestions
    }

    const userMessageCount = rawMessages.filter(m => m.role === 'user').length
    const isStart = userMessageCount <= 1

    const cleanedAssistantContent = content
      .replace(COMPLETION_MARKERS.COLLECTION_COMPLETE, '')
      .replace(COMPLETION_MARKERS.INFO_COMPLETE, '')
      .replace(COMPLETION_MARKERS.CHAT_COMPLETE_REGEX, '')
      .replace(COMPLETION_MARKERS.SUGGESTIONS_REGEX, '')
      .trim()

    const assistantAskedQuestion = /\?/.test(cleanedAssistantContent)

    if (agentMode === 'collector' || isStart || assistantAskedQuestion) {
      return suggestions
    }

    return []
  }, [
    quickSuggestionsMode,
    quickSuggestionsCount,
    rawMessages,
    agentMode,
    isLoading,
    isChatComplete,
    input
  ])

  // Check for completion whenever messages change
  useEffect(() => {
    if (!isLoading && rawMessages.length > 0) {
      checkForCompletion(rawMessages)
    }
  }, [rawMessages, isLoading, checkForCompletion])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [messages.length, isLoading])

  const handleChatComplete = useCallback(() => {
    onChatComplete?.(messages)
  }, [onChatComplete, messages])

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
    >
      {/* Scrollable messages area — full width, messages centered in column */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F5F0E8] dark:bg-[#1A1915]"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#E2DDD4 transparent'
        }}
      >
        {messages.length ? (
          <div className="mx-auto w-full max-w-[760px]">
            <ChatList
              messages={messages}
              isLoading={isLoading}
              agentAvatarGradient={agentAvatarGradient}
              agentAvatarInitial={agentAvatarInitial}
            />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </div>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>

      {/* Sticky input panel */}
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
        quickSuggestions={quickSuggestions}
        googleReviewPlaceId={googleReviewPlaceId}
      />
    </div>
  )
}
