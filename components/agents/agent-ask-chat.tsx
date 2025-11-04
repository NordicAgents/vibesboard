'use client'

import * as React from 'react'
import { useCompletion } from 'ai/react'
import { type Message } from 'ai'

import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { PromptForm } from '@/components/prompt-form'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface AgentAskChatProps {
  agent: VibeAgent
  conversations: VibeAgentConversation[]
}

export function AgentAskChat({ agent, conversations }: AgentAskChatProps) {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [conversationScope, setConversationScope] = React.useState<string>('all')
  const [sessionId, setSessionId] = React.useState(() => nanoid())

  const {
    completion,
    complete,
    isLoading,
    stop,
    setCompletion,
    input,
    setInput
  } = useCompletion({
    id: sessionId,
    api: `/api/agents/${agent.id}/conversations/ask`,
    onFinish: (_prompt, result) => {
      if (!result?.trim()) {
        return
      }
      setMessages(prev => [
        ...prev,
        {
          id: nanoid(),
          role: 'assistant',
          content: result
        }
      ])
      setCompletion('')
    }
  })

  const pendingMessages = React.useMemo(() => {
    if (!completion) {
      return messages
    }
    return [
      ...messages,
      {
        id: 'pending-assistant',
        role: 'assistant' as const,
        content: completion
      }
    ]
  }, [messages, completion])

  const handleSubmit = async (value: string) => {
    const question = value.trim()
    if (!question) {
      return
    }

    setMessages(prev => [
      ...prev,
      {
        id: nanoid(),
        role: 'user',
        content: question
      }
    ])

    await complete(question, {
      body: {
        conversationId: conversationScope === 'all' ? undefined : conversationScope
      }
    })
  }

  const handleNewChat = () => {
    setMessages([])
    setCompletion('')
    setInput('')
    stop()
    setSessionId(nanoid())
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase text-muted-foreground">Ask AI</p>
            <h1 className="text-2xl font-semibold">Insights for {agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              Reference: /a/{agent.agentUrl}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleNewChat}>
            New chat
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            Limit context
          </Label>
          <Select value={conversationScope} onValueChange={setConversationScope}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="All conversations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All conversations</SelectItem>
              {conversations.map(conversation => (
                <SelectItem key={conversation.id} value={conversation.id}>
                  {conversation.summary?.slice(0, 60) ||
                    conversation.messages.at(-1)?.content?.slice(0, 60) ||
                    conversation.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex-1 pb-36 pt-4">
        {pendingMessages.length ? (
          <>
            <ChatList messages={pendingMessages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <div className="mx-auto max-w-2xl px-4 text-center text-muted-foreground">
            <p className="text-base">
              Ask anything about your stored conversations to get quick summaries, trends, or follow-up ideas.
            </p>
          </div>
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
  )
}
