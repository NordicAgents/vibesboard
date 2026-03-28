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
  embed?: boolean
}

const AUTO_START_PREFIX = '__auto_start__'

export function AgentChat({
  agent,
  endpoint,
  conversationId: initialConversationId,
  initialMessages,
  className,
  onChatComplete,
  agentAvatarGradient = 'from-violet-400 to-purple-500',
  agentAvatarInitial = 'A',
  embed
}: AgentChatProps) {
  const [conversationId, setConversationId] = useState<string | undefined>(
    initialConversationId
  )
  const [agentMode, setAgentMode] = useState<AgentMode>(
    agent.mode || 'provider'
  )
  const [maxResponses, setMaxResponses] = useState<number | null>(
    agent.maxResponses ?? null
  )
  const [isAgentDisabled, setIsAgentDisabled] = useState(
    !!(agent.maxAgentResponses && (agent.totalResponseCount ?? 0) >= agent.maxAgentResponses)
  )
  const [isChatComplete, setIsChatComplete] = useState(isAgentDisabled)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasAutoTriggered = useRef(false)

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
      if (isAgentDisabled) {
        setIsChatComplete(true)
        return
      }

      // Count assistant responses (subtract 1 to exclude the greeting message)
      const assistantCount = messagesArr.filter(m => m.role === 'assistant').length - 1

      if (maxResponses && assistantCount >= maxResponses) {
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
    [maxResponses, isAgentDisabled]
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
      conversationId,
      ...(embed ? { embed: true } : {})
    },
    initialMessages: messagesToUse,
    onResponse(response: Response) {
      if (!response.ok) {
        if (response.status === 403) {
          response.clone().json().then(data => {
            if (data?.code === 'AGENT_LIMIT_REACHED') {
              setIsAgentDisabled(true)
              setIsChatComplete(true)
            }
          }).catch(() => {})
        }
        return
      }
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
      const maxRespHeader = response.headers.get('x-max-responses')
      if (maxRespHeader) {
        setMaxResponses(parseInt(maxRespHeader, 10) || null)
      }
      const maxAgentRespHeader = response.headers.get('x-max-agent-responses')
      const totalRespHeader = response.headers.get('x-total-response-count')
      if (maxAgentRespHeader && totalRespHeader) {
        const maxAgent = parseInt(maxAgentRespHeader, 10)
        const totalResp = parseInt(totalRespHeader, 10)
        if (maxAgent && totalResp >= maxAgent) {
          setIsAgentDisabled(true)
          setIsChatComplete(true)
        }
      }
    },
    onFinish(_message) {
      // Completion detection is handled in useEffect
    }
  })

  // Auto-trigger first AI question in collector mode for new conversations
  useEffect(() => {
    if (
      agent.mode === 'collector' &&
      !initialConversationId &&
      (!initialMessages || initialMessages.length === 0) &&
      !hasAutoTriggered.current &&
      !isLoading
    ) {
      hasAutoTriggered.current = true
      append({
        id: `${AUTO_START_PREFIX}${nanoid()}`,
        role: 'user',
        content: 'Hi'
      })
    }
  }, [agent.mode, initialConversationId, initialMessages, isLoading, append])

  // Clean completion markers from messages for display
  const messages = useMemo(() => {
    return rawMessages
      .filter(m => !m.id?.startsWith(AUTO_START_PREFIX))
      .map(m => {
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

    const userMessageCount = rawMessages.filter(m => m.role === 'user' && !m.id?.startsWith(AUTO_START_PREFIX)).length
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
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f7f7f5] dark:bg-[#222f30]"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#e4e3e3 transparent'
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
        isAgentDisabled={isAgentDisabled}
        agentMode={agentMode}
        agentName={agent.name}
        onChatComplete={handleChatComplete}
        quickSuggestions={quickSuggestions}
      />
    </div>
  )
}
