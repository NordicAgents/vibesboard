'use client'

import * as React from 'react'
import { type Message } from 'ai'
import { useCompletion } from 'ai/react'
import { useSearchParams, useRouter } from 'next/navigation'

import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { PromptForm } from '@/components/prompt-form'
import { Button } from '@/components/ui/button'
import { IconSpinner } from '@/components/ui/icons'
// The main app sidebar now shows conversations under each agent.

interface AgentAskChatProps {
  agent: VibeAgent
  ownerId: string
  ownerSessions: VibeAgentConversation[]
}

const sortSessions = (entries: VibeAgentConversation[]) =>
  [...entries].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

export function AgentAskChat({
  agent,
  ownerId,
  ownerSessions
}: AgentAskChatProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sessions, setSessions] = React.useState(() =>
    sortSessions(ownerSessions)
  )
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
    ownerSessions[0]?.id ?? null
  )
  const [messages, setMessages] = React.useState<Message[]>(
    ownerSessions[0]?.messages ?? []
  )
  const sessionIdRef = React.useRef<string | null>(activeSessionId)

  const {
    completion,
    complete,
    isLoading,
    stop,
    setCompletion,
    input,
    setInput
  } = useCompletion({
    id: activeSessionId ?? 'ask-session',
    api: `/api/agents/${agent.id}/conversations/ask`,
    onResponse(response) {
      const nextSessionId = response.headers.get('x-session-id')
      if (nextSessionId) {
        sessionIdRef.current = nextSessionId
        setActiveSessionId(nextSessionId)
      }
    },
    onFinish(prompt, result) {
      const sessionId = sessionIdRef.current
      if (!sessionId) {
        return
      }
      const assistantMessage = {
        id: nanoid(),
        role: 'assistant' as const,
        content: result
      }
      setMessages(prev => {
        const nextMessages = [...prev, assistantMessage]
        persistSession(sessionId, nextMessages, prompt, result)
        return nextMessages
      })
      setCompletion('')
    }
  })

  React.useEffect(() => {
    sessionIdRef.current = activeSessionId
  }, [activeSessionId])

  React.useEffect(() => {
    setSessions(sortSessions(ownerSessions))
  }, [ownerSessions])

  // Sync active session with `?session=` query param from the main sidebar
  React.useEffect(() => {
    const param = searchParams.get('session')
    if (param && param !== activeSessionId) {
      const found = ownerSessions.find(entry => entry.id === param)
      if (found) {
        setActiveSessionId(found.id)
        sessionIdRef.current = found.id
        setMessages(found.messages ?? [])
        setInput('')
        setCompletion('')
      }
    } else if (!param && activeSessionId) {
      // If session param is removed, reset to new chat state
      setActiveSessionId(null)
      sessionIdRef.current = null
      setMessages([])
      setInput('')
      setCompletion('')
    }
  }, [searchParams, ownerSessions, activeSessionId, setInput, setCompletion])

  const persistSession = React.useCallback(
    (
      sessionId: string,
      nextMessages: Message[],
      prompt: string,
      result: string
    ) => {
      setSessions(prev => {
        const existingIndex = prev.findIndex(
          session => session.id === sessionId
        )
        const summary = result?.trim().slice(0, 120) || prompt.slice(0, 120)
        const now = new Date().toISOString()
        if (existingIndex !== -1) {
          const updated = [...prev]
          updated[existingIndex] = {
            ...updated[existingIndex],
            messages: nextMessages,
            summary: summary || updated[existingIndex].summary,
            updatedAt: now
          }
          return sortSessions(updated)
        }
        const newSession: VibeAgentConversation = {
          id: sessionId,
          agentId: agent.id,
          userId: ownerId,
          externalId: null,
          summary,
          messages: nextMessages,
          createdAt: now,
          updatedAt: now
        }
        return sortSessions([newSession, ...prev])
      })
    },
    [agent.id, ownerId]
  )

  const pendingMessages = React.useMemo(() => {
    if (!completion) {
      return messages
    }
    return [
      ...messages,
      {
        id: 'pending-response',
        role: 'assistant' as const,
        content: completion
      }
    ]
  }, [messages, completion])

  const handleSelectSession = (id: string | null) => {
    if (isLoading) {
      return
    }
    if (!id) {
      setActiveSessionId(null)
      sessionIdRef.current = null
      setMessages([])
      setInput('')
      setCompletion('')
      return
    }
    const session = sessions.find(entry => entry.id === id)
    setActiveSessionId(id)
    sessionIdRef.current = id
    setMessages(session?.messages ?? [])
    setInput('')
    setCompletion('')
  }

  const handleSubmit = async (value: string) => {
    const question = value.trim()
    if (!question) {
      return
    }

    const userMessage = {
      id: nanoid(),
      role: 'user' as const,
      content: question
    }
    setMessages(prev => [...prev, userMessage])

    await complete(question, {
      body: {
        sessionId: sessionIdRef.current ?? undefined
      }
    })
  }

  const handleNewChat = () => {
    if (isLoading) {
      stop()
    }
    setInput('')
    setCompletion('')
    setMessages([])
    setActiveSessionId(null)
    sessionIdRef.current = null
    // Clear the session query parameter from URL
    const currentPath = window.location.pathname
    router.replace(currentPath)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative flex flex-1 flex-col">
        {/* Only show new chat button when there are messages */}
        {pendingMessages.length > 0 && (
          <div className="absolute left-4 top-4 z-10">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleNewChat}
              className="rounded-full font-switzer"
            >
              New chat
            </Button>
          </div>
        )}

        {pendingMessages.length > 0 ? (
          <>
            {/* Header when messages exist */}
            <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-center">
              <p className="font-switzer text-sm font-semibold uppercase tracking-[0.4em] text-black-primary dark:text-[#F0F0F0]">
                ASK AI
              </p>
              <p className="mt-1 hidden font-switzer text-sm text-gray-secondary sm:block">
                Analyze visitor conversations
              </p>
            </div>
            <div className="flex-1 overflow-y-auto pb-36 pt-20">
              <ChatList messages={pendingMessages} />
              {isLoading && !completion && (
                <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-[#8A8A8A]">
                  <IconSpinner className="size-4 animate-spin text-accent-orange" />
                  <span>Thinking...</span>
                </div>
              )}
              <ChatScrollAnchor trackVisibility={isLoading} />
            </div>
          </>
        ) : (
          // Centered empty state with input below header
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <div className="w-full max-w-2xl space-y-8 text-center">
              <div className="space-y-3">
                <h1 className="font-switzer text-4xl font-bold tracking-tight text-black-primary dark:text-[#F0F0F0] md:text-5xl">
                  ASK AI
                </h1>
                <p className="hidden font-switzer text-lg text-gray-secondary sm:block">
                  Analyze visitor conversations
                </p>
              </div>

              <div className="w-full">
                <div className="px-4 py-3">
                  <PromptForm
                    onSubmit={handleSubmit}
                    input={input}
                    setInput={setInput}
                    isLoading={isLoading}
                    onStop={() => stop()}
                    placeholder="Ask about your visitor conversations…"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat Input - Only show at bottom when messages exist */}
      {pendingMessages.length > 0 && (
        <div className="sticky bottom-0 border-t border-[#E5E5E5] bg-[#FFFFFF]/95 backdrop-blur-sm dark:border-[#2A2A2A] dark:bg-[#1A1A1A]/95">
          <div className="mx-auto max-w-2xl px-4 pb-4 pt-2">
            <PromptForm
              onSubmit={handleSubmit}
              input={input}
              setInput={setInput}
              isLoading={isLoading}
              onStop={() => stop()}
              placeholder="Ask about your visitor conversations…"
            />
          </div>
        </div>
      )}
    </div>
  )
}
