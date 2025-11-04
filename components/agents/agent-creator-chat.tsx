'use client'

import { useChat } from 'ai/react'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { EmptyScreen } from '@/components/empty-screen'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'

interface AgentCreatorChatProps {
  className?: string
}

export function AgentCreatorChat({ className }: AgentCreatorChatProps) {
  const { messages, append, reload, stop, isLoading, input, setInput } =
    useChat({
      id: 'agent-creator',
      api: '/api/agent-creator',
      onResponse(res: Response) {
        if (res.status === 401) {
          toast.error('Please sign in to create an agent.')
        }
      }
    })

  return (
    <div className={cn('flex flex-1 flex-col', className)}>
      <div className="border-b bg-background p-4">
        <p className="text-sm uppercase text-muted-foreground">Create</p>
        <h1 className="text-2xl font-semibold">Build an agent via chat</h1>
        <p className="text-sm text-muted-foreground">
          I’ll ask a few questions, then create it for you.
        </p>
      </div>
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
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
      />
    </div>
  )
}
