'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useChat } from 'ai/react'
import { type UIMessage } from 'ai'
import { type Message } from '@vibesboard/contracts'
import { ChevronRight } from 'lucide-react'

import { type AgentMode, type VibeAgent } from '@vibesboard/contracts'
import {
  checkCompletion,
  isNewCollectorConversation
} from '@vibesboard/ai/chat-completion-check'
import { cn } from '@vibesboard/utils'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { EmptyScreen } from '@/components/empty-screen'
import { nanoid } from '@vibesboard/utils'

// Completion signal markers (must match server-side)
const COMPLETION_MARKERS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]',
  CHAT_COMPLETE_REGEX: /<!--CHAT_COMPLETE:(\{.*?\})-->/,
  SUGGESTIONS_REGEX: /<!--SUGGESTIONS:\s*(\{[\s\S]*?\})-->/g,
  AGENT_HANDOFF_REGEX: /<!--AGENT_HANDOFF:(\{.*?\})-->/,
  HANDOFF_TO_AGENT_MARKER: /\[HANDOFF_TO_AGENT:[a-zA-Z0-9_-]+\]/
}

const HANDOFF_INDICATOR_PREFIX = '__handoff_indicator__'
const HANDOFF_CONTINUE_PREFIX = '__handoff_continue__'

interface HandoffChainEntry {
  agentId: string
  agentName: string
}

interface AgentChatProps {
  agent: VibeAgent
  endpoint: string
  conversationId?: string
  initialMessages?: Message[]
  className?: string
  onChatComplete?: (messages?: Message[], conversationId?: string) => void
  agentAvatarGradient?: string
  agentAvatarInitial?: string
  agentLogoUrl?: string | null
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
  agentLogoUrl,
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
  const [remainingResponses, setRemainingResponses] = useState<number | null>(
    null
  )
  const remainingResponsesRef = useRef<number | null>(null)
  const [isAgentDisabled, setIsAgentDisabled] = useState(
    !!(
      agent.maxAgentResponses &&
      (agent.totalResponseCount ?? 0) >= agent.maxAgentResponses
    )
  )
  const [isChatComplete, setIsChatComplete] = useState(isAgentDisabled)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasAutoTriggered = useRef(false)
  const isCorrecting = useRef(false)

  // Handoff state
  const [handoffChain, setHandoffChain] = useState<HandoffChainEntry[]>([])
  const [activeAgentId, setActiveAgentId] = useState(agent.id)
  const [activeAgentName, setActiveAgentName] = useState(agent.name)
  const [handoffAgentId, setHandoffAgentId] = useState<string | undefined>()
  const handoffProcessedRef = useRef<Set<string>>(new Set())

  const quickSuggestionsMode = agent.quickSuggestionsMode ?? 'off'
  const quickSuggestionsCount = agent.quickSuggestionsCount ?? 4

  const chatKey = useMemo(
    () => initialConversationId ?? nanoid(),
    [initialConversationId]
  )
  const defaultGreeting =
    agent.mode === 'collector'
      ? 'Hi! I have a few questions for you.'
      : 'Hi! How can I help you today?'

  // For collector mode new conversations, start empty so typing indicator shows
  // while the LLM generates the combined greeting + first question
  const isNewCollectorChat = isNewCollectorConversation(
    agent.mode,
    initialConversationId,
    initialMessages
  )

  const defaultInitialMessages: Message[] = useMemo(
    () =>
      isNewCollectorChat
        ? []
        : [
            {
              id: nanoid(),
              role: 'assistant',
              content: agent.greetingText || defaultGreeting
            }
          ],
    [chatKey, agent.greetingText, defaultGreeting, isNewCollectorChat]
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
      const result = checkCompletion({
        messages: messagesArr,
        isAgentDisabled,
        remainingResponses: remainingResponsesRef.current,
        isCorrecting: isCorrecting.current
      })
      if (result.shouldClearCorrecting) {
        isCorrecting.current = false
      }
      if (result.shouldComplete) {
        setIsChatComplete(true)
      }
    },
    [isAgentDisabled]
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
    streamProtocol: 'text',
    body: {
      conversationId,
      ...(embed ? { embed: true } : {}),
      ...(handoffAgentId ? { handoffAgentId } : {})
    },
    initialMessages: messagesToUse,
    onResponse(response: Response) {
      if (!response.ok) {
        if (response.status === 403) {
          response
            .clone()
            .json()
            .then(data => {
              if (data?.code === 'AGENT_LIMIT_REACHED') {
                setIsAgentDisabled(true)
                setIsChatComplete(true)
              }
            })
            .catch(() => {})
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
      const remainingRespHeader = response.headers.get('x-remaining-responses')
      if (remainingRespHeader !== null && remainingRespHeader !== '') {
        const val = parseInt(remainingRespHeader, 10)
        remainingResponsesRef.current = val
        setRemainingResponses(val)
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
      // Track which agent responded
      const agentIdHeader = response.headers.get('x-agent-id')
      const agentNameHeader = response.headers.get('x-agent-name')
      if (agentIdHeader) {
        setActiveAgentId(agentIdHeader)
      }
      if (agentNameHeader) {
        setActiveAgentName(agentNameHeader)
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

  // Detect agent handoff markers and trigger continuation
  useEffect(() => {
    if (isLoading || rawMessages.length === 0) return

    const lastAssistant = [...rawMessages]
      .reverse()
      .find(m => m.role === 'assistant')

    if (!lastAssistant?.content) return

    const handoffMatch = lastAssistant.content.match(
      COMPLETION_MARKERS.AGENT_HANDOFF_REGEX
    )
    if (!handoffMatch) return

    // Prevent processing the same handoff twice
    if (handoffProcessedRef.current.has(lastAssistant.id)) return
    handoffProcessedRef.current.add(lastAssistant.id)

    try {
      const meta = JSON.parse(handoffMatch[1]) as {
        targetAgentId: string
        targetAgentName: string
      }

      // Update handoff chain
      setHandoffChain(prev => [
        ...prev,
        { agentId: meta.targetAgentId, agentName: meta.targetAgentName }
      ])
      setActiveAgentId(meta.targetAgentId)
      setActiveAgentName(meta.targetAgentName)
      setHandoffAgentId(meta.targetAgentId)

      // Auto-send a continuation message to trigger the target agent,
      // then clear handoffAgentId so subsequent messages don't re-trigger
      // the continuation path on the server.
      setTimeout(() => {
        append({
          id: `${HANDOFF_CONTINUE_PREFIX}${nanoid()}`,
          role: 'user',
          content: 'Continue'
        }).then(() => {
          setHandoffAgentId(undefined)
        })
      }, 500)
    } catch {
      // Invalid handoff metadata, ignore
    }
  }, [rawMessages, isLoading, append])

  // Clean completion markers from messages for display, insert handoff indicators
  const messages = useMemo(() => {
    const cleaned: UIMessage[] = []

    for (const m of rawMessages) {
      // Skip auto-start messages
      if (m.id?.startsWith(AUTO_START_PREFIX)) continue
      if (m.id?.startsWith(HANDOFF_CONTINUE_PREFIX)) continue

      if (m.role === 'assistant' && m.content) {
        // Check for handoff metadata to insert indicator
        const handoffMatch = m.content.match(
          COMPLETION_MARKERS.AGENT_HANDOFF_REGEX
        )

        let cleanedContent = m.content
          .replace(COMPLETION_MARKERS.COLLECTION_COMPLETE, '')
          .replace(COMPLETION_MARKERS.INFO_COMPLETE, '')
          .replace(COMPLETION_MARKERS.CHAT_COMPLETE_REGEX, '')
          .replace(COMPLETION_MARKERS.SUGGESTIONS_REGEX, '')
          .replace(COMPLETION_MARKERS.AGENT_HANDOFF_REGEX, '')
          .replace(COMPLETION_MARKERS.HANDOFF_TO_AGENT_MARKER, '')
          .trim()

        if (cleanedContent !== m.content) {
          cleaned.push({ ...m, content: cleanedContent })
        } else {
          cleaned.push(m)
        }

        // Insert a handoff indicator message after this assistant message
        if (handoffMatch) {
          try {
            const meta = JSON.parse(handoffMatch[1])
            cleaned.push({
              id: `${HANDOFF_INDICATOR_PREFIX}${m.id}`,
              role: 'system',
              content: meta.targetAgentName,
              parts: []
            } as UIMessage)
          } catch {
            // ignore
          }
        }
      } else {
        cleaned.push(m)
      }
    }

    return cleaned
  }, [rawMessages])

  const quickSuggestions = useMemo(() => {
    if (quickSuggestionsMode === 'off') return []
    if (isLoading || isChatComplete) return []
    if (input.trim().length) return []

    const lastAssistant = [...rawMessages]
      .reverse()
      .find(m => m.role === 'assistant' && typeof m.content === 'string')

    const content = lastAssistant?.content ?? ''
    const match = content.match(/<!--SUGGESTIONS:\s*(\{[\s\S]*?\})-->/)
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

    const userMessageCount = rawMessages.filter(
      m =>
        m.role === 'user' &&
        !m.id?.startsWith(AUTO_START_PREFIX) &&
        !m.id?.startsWith(HANDOFF_CONTINUE_PREFIX)
    ).length
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

  const lastMessageContent = messages[messages.length - 1]?.content ?? ''

  // Auto-scroll only the chat history container. Using a viewport-level
  // scroll anchor here can move the fixed public chat shell away from the
  // bottom after streaming responses grow.
  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const frame = window.requestAnimationFrame(() => {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: isLoading ? 'auto' : 'smooth'
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, lastMessageContent, isLoading])

  const handleChatComplete = useCallback(() => {
    onChatComplete?.(messages, conversationId)
  }, [onChatComplete, messages, conversationId])

  const handleCorrection = useCallback(() => {
    isCorrecting.current = true
    setIsChatComplete(false)
    append({
      id: nanoid(),
      role: 'user',
      content: 'I need to correct one of my previous answers.'
    })
  }, [append])

  const handleEndConversation = useCallback(() => {
    setIsChatComplete(true)
  }, [])

  return (
    <div
      className={cn(
        'grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden',
        className
      )}
    >
      {/* Handoff breadcrumb trail */}
      {handoffChain.length > 0 && (
        <div className="row-start-1 flex items-center gap-1 border-b border-border bg-bg-surface px-4 py-2 text-xs text-text-secondary">
          <span>{agent.name}</span>
          {handoffChain.map((h, i) => (
            <Fragment key={h.agentId}>
              <ChevronRight className="size-3" />
              <span
                className={
                  i === handoffChain.length - 1
                    ? 'font-medium text-text-primary'
                    : ''
                }
              >
                {h.agentName}
              </span>
            </Fragment>
          ))}
        </div>
      )}

      {/* Scrollable messages area — full width, messages centered in column */}
      <div
        ref={scrollRef}
        className="row-start-2 min-h-0 overflow-y-auto overscroll-contain bg-[#f7f7f5] dark:bg-[#222f30]"
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
              agentLogoUrl={agentLogoUrl}
              handoffIndicatorPrefix={HANDOFF_INDICATOR_PREFIX}
            />
          </div>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>

      {/* Input panel */}
      <div className="row-start-3 min-h-0">
        <ChatPanel
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
          agentName={activeAgentName}
          onChatComplete={handleChatComplete}
          onCorrect={handleCorrection}
          onEndConversation={handleEndConversation}
          quickSuggestions={quickSuggestions}
        />
      </div>
    </div>
  )
}
