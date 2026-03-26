import { NextRequest, NextResponse } from 'next/server'
import { StreamingTextResponse, type Message } from 'ai'

import { getAgentById } from '@/lib/agents/server'
import { publicAgentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { runAgentStream } from '@/lib/agent/runtime'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import { nanoid } from '@/lib/utils'
import {
  detectCompletionMarker,
  stripCompletionMarkers,
  wrapStreamWithCompletionDetection
} from '@/lib/agent/completion'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from '@/lib/agents/notifications'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  if (!agent.allowAnonymous) {
    return new NextResponse('Agent does not allow anonymous chat', {
      status: 403
    })
  }

  const tenantId = agent.tenantId!
  const body = await req.json()
  const isEmbed = body.embed === true
  const externalId = await ensureExternalSessionId({ crossOrigin: isEmbed })
  const payload = publicAgentChatRequestSchema.parse({
    ...body,
    externalId
  })
  const normalizedMessages = payload.messages.map(message => ({
    ...message,
    id: message.id ?? nanoid()
  })) as Message[]

  const conversation = await ensureConversation({
    tenantId,
    agentId: agent.id,
    externalId,
    conversationId: payload.conversationId,
    initialMessages: normalizedMessages
  })

  const userMessageCount = normalizedMessages.filter(
    m => m.role === 'user'
  ).length

  const stream = await runAgentStream({
    agent,
    messages: normalizedMessages,
    onCompletion: async completion => {
      const reason = detectCompletionMarker(completion)
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
        tenantId,
        agentId: agent.id,
        conversationId: conversation.id,
        messages: nextMessages,
        summary: null
      })

      const event = mapCompletionToEvent(reason)
      if (event) {
        dispatchAgentNotification({
          agent,
          conversationId: conversation.id,
          event,
          messageCount: userMessageCount
        })
      }
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
