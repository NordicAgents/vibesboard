import { StreamingTextResponse, type Message } from 'ai'
import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { fetchAgentFileContext } from '@/lib/agent/rag'
import { runAgentStream } from '@/lib/agent/runtime'
import { nanoid } from '@/lib/utils'
import {
  stripCompletionMarkers,
  wrapStreamWithCompletionDetection
} from '@/lib/agent/completion'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  // Look up agent across all tenants by ID
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const body = await req.json()
  const payload = agentChatRequestSchema.parse(body)
  const normalizedMessages = payload.messages.map(message => ({
    ...message,
    id: message.id ?? nanoid()
  })) as Message[]

  const conversation = await ensureConversation({
    tenantId: agent.tenantId!,
    agentId: agent.id,
    conversationId: payload.conversationId,
    userId: user.id,
    initialMessages: normalizedMessages
  })

  // Count user messages for max messages check
  const userMessageCount = normalizedMessages.filter(m => m.role === 'user').length

  const context = await fetchAgentFileContext({
    fileKeys: agent.fileKeys
  })

  const stream = await runAgentStream({
    agent,
    messages: normalizedMessages,
    context,
    toolContext: {
      fileContext: context
    },
    onCompletion: async completion => {
      const cleanedCompletion = stripCompletionMarkers(completion)
      const nextMessages = [
        ...normalizedMessages,
        {
          id: nanoid(),
          role: 'assistant' as const,
          content: cleanedCompletion
        }
      ]
      await updateConversationMessages({
        tenantId: agent.tenantId!,
        agentId: agent.id,
        conversationId: conversation.id,
        messages: nextMessages,
        summary: null
      })
    }
  })

  const transformedStream = wrapStreamWithCompletionDetection(
    stream,
    agent.maxMessages,
    userMessageCount
  )

  return new StreamingTextResponse(transformedStream, {
    headers: {
      'x-conversation-id': conversation.id,
      'x-agent-mode': agent.mode,
      'x-max-messages': String(agent.maxMessages ?? '')
    }
  })
}
