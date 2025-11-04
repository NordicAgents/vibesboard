'use client'

import { useEffect, useState } from 'react'
import { type Message } from 'ai'
import Link from 'next/link'

import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { AgentChat } from '@/components/agent-chat'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'

interface PublicAgentExperienceProps {
  agent: VibeAgent
}

export function PublicAgentExperience({ agent }: PublicAgentExperienceProps) {
  const [conversations, setConversations] = useState<VibeAgentConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [initialMessages, setInitialMessages] = useState<Message[] | undefined>(
    undefined
  )

  const loadConversations = async () => {
    const res = await fetch(`/api/public/agents/${agent.agentUrl}/conversations`)
    if (!res.ok) return
    const json = await res.json()
    setConversations(json.conversations ?? [])
  }

  useEffect(() => {
    loadConversations()
  }, [])

  const loadConversation = async (conversationId: string) => {
    const res = await fetch(
      `/api/public/agents/${agent.agentUrl}/conversations/${conversationId}`
    )
    if (!res.ok) return
    const json = await res.json()
    setInitialMessages(json.conversation.messages)
    setSelectedId(conversationId)
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex-1">
        <AgentChat
          key={selectedId ?? 'new'}
          agent={agent}
          endpoint={`/api/public/agents/${agent.agentUrl}/chat`}
          conversationId={selectedId}
          initialMessages={initialMessages}
        />
      </div>
      <aside className="w-full lg:w-80">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Your conversations</p>
            <Button
              size="sm"
              variant="link"
              onClick={() => {
                setSelectedId(undefined)
                setInitialMessages(undefined)
              }}
            >
              New chat
            </Button>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {conversations.length === 0 && (
              <p className="text-muted-foreground">
                Start chatting to see history here.
              </p>
            )}
            {conversations.map(conversation => (
              <button
                key={conversation.id}
                onClick={() => loadConversation(conversation.id)}
                className="w-full rounded-md border border-transparent p-3 text-left hover:border-primary"
              >
                <p className="font-medium">
                  {conversation.summary ||
                    conversation.messages.at(-1)?.content.slice(0, 60) ||
                    'Conversation'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Updated {formatDate(conversation.updatedAt)}
                </p>
              </button>
            ))}
          </div>
        </Card>
        <div className="mt-4 rounded-md border p-3 text-xs text-muted-foreground">
          Conversations are private to this browser via an anonymous cookie.
          <Link href="/sign-in" className="text-primary">
            {' '}
            Sign in
          </Link>{' '}
          to sync everywhere.
        </div>
      </aside>
    </div>
  )
}
