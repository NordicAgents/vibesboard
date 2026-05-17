'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import type { Message } from '@vibesboard/contracts'
import { nanoid } from '@vibesboard/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AgentBuilderHelperProps {
  onUseSuggestion: (text: string) => void
}

export function AgentBuilderHelper({
  onUseSuggestion
}: AgentBuilderHelperProps) {
  const [error, setError] = useState<string | null>(null)
  const { messages, input, setInput, append, isLoading } = useChat({
    api: '/api/agent-helper',
    id: 'agent-builder-helper',
    streamProtocol: 'text',
    body: {
      mode: 'agent-builder-helper'
    },
    onResponse(response: Response) {
      if (response.status === 401) {
        setError('Please sign in to use the helper')
      } else {
        setError(null)
      }
    }
  })

  const formatContent = (content: Message['content']) =>
    typeof content === 'string' ? content : ''

  return (
    <div className="flex h-full flex-col rounded-3xl border border-black-10 bg-purewhite-bg p-6 shadow-lg">
      <div className="mb-4 font-switzer text-base font-semibold text-black-primary">
        Instruction helper
      </div>
      <div className="bg-beige-bg/30 flex-1 space-y-3 overflow-auto rounded-2xl p-4 text-sm">
        {!messages.length && (
          <p className="font-switzer text-gray-secondary">
            Describe what your agent should do and get a draft prompt back.
          </p>
        )}
        {messages.map((message: Message) => (
          <div
            key={message.id}
            className="space-y-2 rounded-2xl border border-black-10 bg-purewhite-bg p-4 shadow-sm"
          >
            <div className="font-switzer text-xs font-medium uppercase tracking-wider text-gray-secondary">
              {message.role === 'assistant' ? 'Helper' : 'You'}
            </div>
            <p className="whitespace-pre-wrap font-switzer text-black-primary">
              {formatContent(message.content)}
            </p>
            {message.role === 'assistant' && (
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full font-switzer"
                onClick={() => onUseSuggestion(formatContent(message.content))}
              >
                Use this suggestion
              </Button>
            )}
          </div>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async event => {
          event.preventDefault()
          if (!input?.trim()) return
          await append({
            id: nanoid(),
            role: 'user',
            content: input
          })
          setInput('')
        }}
      >
        <Input
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="Ask for ideas..."
        />
        <Button
          type="submit"
          disabled={isLoading}
          className="rounded-full font-switzer"
        >
          Send
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
