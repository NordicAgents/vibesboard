'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import { nanoid } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AgentBuilderHelperProps {
  onUseSuggestion: (text: string) => void
}

export function AgentBuilderHelper({ onUseSuggestion }: AgentBuilderHelperProps) {
  const [error, setError] = useState<string | null>(null)
  const { messages, input, setInput, append, isLoading } = useChat({
    api: '/api/agent-helper',
    id: 'agent-builder-helper',
    body: {
      mode: 'agent-builder-helper'
    },
    onResponse(response) {
      if (response.status === 401) {
        setError('Please sign in to use the helper')
      } else {
        setError(null)
      }
    }
  })

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">Instruction helper</div>
      <div className="flex-1 space-y-3 overflow-auto rounded-md bg-muted/40 p-3 text-sm">
        {!messages.length && (
          <p className="text-muted-foreground">
            Describe what your agent should do and get a draft prompt back.
          </p>
        )}
        {messages.map(message => (
          <div
            key={message.id}
            className="space-y-2 rounded-md bg-background p-3 shadow-sm"
          >
            <div className="text-xs uppercase text-muted-foreground">
              {message.role === 'assistant' ? 'Helper' : 'You'}
            </div>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.role === 'assistant' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onUseSuggestion(message.content)}
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
        <Button type="submit" disabled={isLoading}>
          Send
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
