'use client'

import * as React from 'react'
import { type Message } from 'ai'
import { useCompletion } from 'ai/react'
import { useSearchParams } from 'next/navigation'

import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { PromptForm } from '@/components/prompt-form'
import { Button } from '@/components/ui/button'
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
  const searchParams = useSearchParams()
  const [sessions, setSessions] = React.useState(() => sortSessions(ownerSessions))
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
    ownerSessions[0]?.id ?? null
  )
  const [messages, setMessages] = React.useState<Message[]>(
    ownerSessions[0]?.messages ?? []
  )
  const sessionIdRef = React.useRef<string | null>(activeSessionId)

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
    }
  }, [searchParams, ownerSessions])

  React.useEffect(() => {
    if (!activeSessionId && ownerSessions.length) {
      setActiveSessionId(ownerSessions[0].id)
      setMessages(ownerSessions[0].messages)
    }
  }, [ownerSessions, activeSessionId])

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

  const persistSession = React.useCallback(
    (sessionId: string, nextMessages: Message[], prompt: string, result: string) => {
      setSessions(prev => {
        const existingIndex = prev.findIndex(session => session.id === sessionId)
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
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative flex flex-1 flex-col">
        {/* Only show new chat button when there are messages */}
        {pendingMessages.length > 0 && (
          <div className="absolute left-4 top-4 z-10">
            <Button size="sm" variant="secondary" onClick={handleNewChat} className="rounded-full font-switzer">
              New chat
            </Button>
          </div>
        )}

        {pendingMessages.length > 0 ? (
          <>
            {/* Header when messages exist */}
            <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-center">
              <p className="font-switzer text-sm font-semibold uppercase tracking-[0.4em] text-black-primary dark:text-white">
                ASK AI
              </p>
              <p className="mt-1 font-switzer text-sm text-gray-secondary">Chat with conversations</p>
            </div>
            <div className="flex-1 overflow-y-auto pb-36 pt-20">
              <ChatList messages={pendingMessages} />
              <ChatScrollAnchor trackVisibility={isLoading} />
            </div>
          </>
        ) : (
          // Centered empty state with input below header
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <div className="w-full max-w-2xl space-y-8 text-center">
              <div className="space-y-3">
                <h1 className="font-switzer text-4xl font-bold tracking-tight text-black-primary md:text-5xl dark:text-white">
                  ASK AI
                </h1>
                <p className="font-switzer text-lg text-gray-secondary">
                  Chat with conversations
                </p>
              </div>

              {/* Input centered below header */}
              <div className="w-full">
                <div className="mb-2 flex h-8 items-center justify-center">
                  {isLoading && (
                    <Button variant="outline" onClick={() => stop()} className="rounded-full bg-purewhite-bg font-switzer">
                      Stop generating
                    </Button>
                  )}
                </div>
                <div className="rounded-3xl border border-black-10 bg-purewhite-bg px-4 py-3 shadow-lg">
                  <PromptForm
                    onSubmit={handleSubmit}
                    input={input}
                    setInput={setInput}
                    isLoading={isLoading}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Chat Input - Only show at bottom when messages exist */}
      {pendingMessages.length > 0 && (
        <div className="sticky bottom-0 bg-gradient-to-b from-beige-bg/10 from-10% to-beige-bg/30 to-50%">
          <div className="mx-auto max-w-xl px-4 pb-4 pt-2">
            <div className="mb-2 flex h-8 items-center justify-center">
              {isLoading ? (
                <Button variant="outline" onClick={() => stop()} className="rounded-full bg-purewhite-bg font-switzer">
                  Stop generating
                </Button>
              ) : null}
            </div>
            <div className="border-t border-black-10 bg-purewhite-bg px-4 py-3 shadow-lg sm:rounded-t-3xl sm:border">
              <div className="mx-auto max-w-lg">
                <PromptForm
                  onSubmit={handleSubmit}
                  input={input}
                  setInput={setInput}
                  isLoading={isLoading}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
