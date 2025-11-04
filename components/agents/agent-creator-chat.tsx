'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { EmptyScreen } from '@/components/empty-screen'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { nanoid } from '@/lib/utils'

interface AgentCreatorChatProps {
  className?: string
}

export function AgentCreatorChat({ className }: AgentCreatorChatProps) {
  const [chatId, setChatId] = useState<string>('agent-creator')
  const { messages, append, reload, stop, isLoading, input, setInput } =
    useChat({
      id: chatId,
      api: '/api/agent-creator',
      onResponse(res: Response) {
        if (res.status === 401) {
          toast.error('Please sign in to create an agent.')
        }
      }
    })

  const handleNewChat = () => {
    if (isLoading) stop()
    setInput('')
    setChatId(`agent-creator-${nanoid()}`)
  }

  return (
    <div className={cn('flex min-h-[calc(100vh-4rem)] flex-1', className)}>
      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 pb-36 pt-20">
          <div className="absolute left-4 top-4 z-10">
            <Button size="sm" variant="secondary" onClick={handleNewChat}>
              New chat
            </Button>
          </div>
          <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-muted-foreground">
              Conversation Agent Builder
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Build an agent via chat</p>
          </div>
          {messages.length ? (
            <>
              <ChatList messages={messages} />
              <ChatScrollAnchor trackVisibility={isLoading} />
            </>
          ) : (
            <div className="mx-auto max-w-2xl px-4 text-center text-muted-foreground">
              <EmptyScreen setInput={setInput} />
            </div>
          )}
        </div>
        <ChatPanel
          id={chatId}
          isLoading={isLoading}
          stop={stop}
          append={append}
          reload={reload}
          messages={messages}
          input={input}
          setInput={setInput}
        />
      </div>
    </div>
  )
}
