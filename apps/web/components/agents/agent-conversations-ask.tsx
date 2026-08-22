'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useCompletion } from '@ai-sdk/react'

import { type VibeAgentConversation } from '@vibesboard/contracts'
import { getConversationPreview } from '@vibesboard/agents/conversation-preview'
import { formatDate } from '@vibesboard/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface AgentConversationsAskProps {
  agentId: string
  conversations: VibeAgentConversation[]
}

export function AgentConversationsAsk({
  agentId,
  conversations
}: AgentConversationsAskProps) {
  const [scope, setScope] = useState<string>('all')
  const {
    completion,
    complete,
    isLoading,
    stop,
    error,
    setCompletion,
    input,
    setInput
  } = useCompletion({
    api: `/api/agents/${agentId}/conversations/ask`
  })

  const selectedConversation = useMemo(
    () => conversations.find(convo => convo.id === scope),
    [conversations, scope]
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!input.trim()) {
      return
    }

    setCompletion('')
    await complete(input, {
      body: {
        conversationId: scope === 'all' ? undefined : scope
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ask AI about conversations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="conversation-scope">Limit to</Label>
          <Select value={scope} onValueChange={value => setScope(value)}>
            <SelectTrigger id="conversation-scope">
              <SelectValue placeholder="All conversations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All conversations</SelectItem>
              {conversations.map(conversation => (
                <SelectItem key={conversation.id} value={conversation.id}>
                  {getConversationPreview(
                    conversation.messages,
                    conversation.summary
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {scope !== 'all' && selectedConversation && (
            <p className="text-xs text-muted-foreground">
              Using conversation updated{' '}
              {formatDate(selectedConversation.updatedAt)}
            </p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="What do you want to know about these chats?"
            disabled={isLoading}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isLoading || input.trim() === ''}>
              {isLoading ? 'Thinking…' : 'Ask AI'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!completion && !input}
              onClick={() => {
                stop()
                setInput('')
                setCompletion('')
              }}
            >
              Clear
            </Button>
          </div>
        </form>
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {completion && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
            <p className="font-medium text-muted-foreground">Answer</p>
            <p className="whitespace-pre-wrap leading-relaxed">{completion}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
