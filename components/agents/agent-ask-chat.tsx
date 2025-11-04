'use client'

import * as React from 'react'
import { type Message } from 'ai'
import { useCompletion } from 'ai/react'

import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { PromptForm } from '@/components/prompt-form'
import { Button } from '@/components/ui/button'
import { AgentAskSidebar } from '@/components/agents/agent-ask-sidebar'

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
    <div className="flex min-h-[calc(100vh-4rem)] flex-1">
      <aside className="hidden w-80 border-r bg-muted/20 p-4 lg:block">
        <AgentAskSidebar
          sessions={sessions}
          activeId={activeSessionId}
          onSelect={handleSelectSession}
          onNewChat={handleNewChat}
        />
      </aside>

      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 pb-36 pt-20">
          <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-muted-foreground">
              ASK AI
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Chat with conversations</p>
          </div>
          {pendingMessages.length ? (
            <>
              <ChatList messages={pendingMessages} />
              <ChatScrollAnchor trackVisibility={isLoading} />
            </>
          ) : (
            <div className="mx-auto max-w-2xl px-4 text-center text-muted-foreground" />
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 bg-gradient-to-b from-muted/10 from-10% to-muted/30 to-50%">
          <div className="mx-auto max-w-2xl px-4">
            <div className="flex h-10 items-center justify-center">
              {isLoading ? (
                <Button variant="outline" onClick={() => stop()} className="bg-background">
                  Stop generating
                </Button>
              ) : null}
            </div>
            <div className="space-y-4 border-t bg-background px-4 py-2 shadow-lg sm:rounded-t-xl sm:border md:py-4">
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
    </div>
  )
}
