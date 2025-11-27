'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { PromptForm } from '@/components/prompt-form'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { EmptyScreen } from '@/components/empty-screen'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/ui/icons'
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
    <div className="flex min-h-[calc(100vh-4rem)] flex-1 bg-beige-bg dark:bg-background">
      <div className="flex flex-1 flex-col">
        <div className="relative flex flex-1 flex-col">
          {/* Only show new chat button when there are messages */}
          {messages.length > 0 && (
            <div className="absolute left-4 top-4 z-10">
              <Button
                size="icon"
                className="h-10 w-10"
                variant="secondary"
                onClick={handleNewChat}
                aria-label="New chat"
                title="New chat"
              >
                <IconPlus className="h-6 w-6" />
              </Button>
            </div>
          )}

          {messages.length > 0 ? (
            <>
              {/* Header when messages exist */}
              <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-center">
                <p className="font-switzer text-sm font-semibold uppercase tracking-[0.4em] text-black-primary dark:text-white">
                  Conversation Agent Builder
                </p>
                <p className="mt-1 font-switzer text-sm text-gray-secondary">Build an agent via chat</p>
              </div>
              <div className="flex-1 overflow-y-auto pb-36 pt-20">
                <ChatList messages={messages} />
                <ChatScrollAnchor trackVisibility={isLoading} />
              </div>
            </>
          ) : (
            // Centered empty state with input below header
            <div className="flex flex-1 flex-col items-center justify-center px-4">
              <div className="w-full max-w-2xl space-y-8 text-center">
                <div className="space-y-3">
                  <h1 className="font-switzer text-4xl font-bold tracking-tight text-black-primary md:text-5xl dark:text-white">
                    Conversation Agent Builder
                  </h1>
                  <p className="font-switzer text-lg text-gray-secondary">
                    Build an agent via chat
                  </p>
                </div>

                {/* Input centered below header */}
                <div className="w-full">
                  <div className="rounded-3xl border border-black-10 bg-purewhite-bg px-4 py-3 shadow-lg dark:bg-card dark:border-border">
                    <PromptForm
                      onSubmit={async (value: string) => {
                        await append({
                          id: chatId,
                          content: value,
                          role: 'user'
                        })
                      }}
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
        {messages.length > 0 && (
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
        )}
      </div>
    </div>
  )
}
