import { StreamingTextResponse, type Message } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { getAgentById } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { runAgentStream } from '@/lib/agent/runtime'
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
import { Collections } from '@/lib/firestore-types'

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

  // Check agent-level response limit
  if (
    agent.maxAgentResponses &&
    (agent.totalResponseCount ?? 0) >= agent.maxAgentResponses
  ) {
    return NextResponse.json(
      { error: 'Agent response limit reached', code: 'AGENT_LIMIT_REACHED' },
      { status: 403 }
    )
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

  // Count assistant responses for max responses check
  // +1 for the response being streamed, -1 to exclude the greeting message
  const assistantCount =
    normalizedMessages.filter(m => m.role === 'assistant').length

  // Calculate remaining responses so the AI can wrap up gracefully
  const remainingResponses = agent.maxResponses
    ? agent.maxResponses - assistantCount + 1
    : null

  const stream = await runAgentStream({
    agent,
    messages: normalizedMessages,
    remainingResponses,
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
        tenantId: agent.tenantId!,
        agentId: agent.id,
        conversationId: conversation.id,
        messages: nextMessages,
        summary: null
      })

      // Increment agent-level response counter
      adminDb
        .collection(Collections.agents(agent.tenantId!))
        .doc(agent.id)
        .update({ totalResponseCount: FieldValue.increment(1) })
        .catch(err =>
          console.error('[chat] Failed to increment response count:', err)
        )

      const event = mapCompletionToEvent(reason)
      if (event) {
        dispatchAgentNotification({
          agent,
          conversationId: conversation.id,
          event,
          messageCount: assistantCount
        })
      }
    }
  })

  const transformedStream = wrapStreamWithCompletionDetection(
    stream,
    agent.maxResponses,
    assistantCount
  )

  return new StreamingTextResponse(transformedStream, {
    headers: {
      'x-conversation-id': conversation.id,
      'x-agent-mode': agent.mode,
      'x-max-responses': String(agent.maxResponses ?? ''),
      'x-max-agent-responses': String(agent.maxAgentResponses ?? ''),
      'x-total-response-count': String((agent.totalResponseCount ?? 0) + 1)
    }
  })
}
