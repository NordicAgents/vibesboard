import { StreamingTextResponse, type Message } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { getAgentById, getAgentNames } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages,
  getConversation,
  recordConversationHandoff
} from '@/lib/agents/conversations'
import { runAgentStream } from '@/lib/agent/runtime'
import { nanoid } from '@/lib/utils'
import {
  detectCompletionMarker,
  extractHandoffTarget,
  stripCompletionMarkers,
  wrapStreamWithCompletionDetection
} from '@/lib/agent/completion'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from '@/lib/agents/notifications'
import { validateHandoff, buildHandoffContext } from '@/lib/agent/handoff'
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

  // Determine which agent actually handles this request
  let activeAgent = agent
  let handoffContext: string | undefined
  let handoffTargetNames: Record<string, string> = {}

  // If client requested handoff to another agent
  if (payload.handoffAgentId) {
    const existingConv = await getConversation(
      agent.tenantId!,
      agent.id,
      conversation.id
    )
    const chain = existingConv?.handoffChain ?? []
    const lastEntry = chain[chain.length - 1]
    const isContinuation =
      lastEntry?.toAgentId === payload.handoffAgentId

    if (isContinuation) {
      // This is a continuation — the handoff was already recorded.
      // Just load the target agent and route to it.
      const targetAgent = await getAgentById(payload.handoffAgentId)
      if (!targetAgent) {
        return NextResponse.json({ error: 'Target agent not found' }, { status: 404 })
      }
      activeAgent = targetAgent
      handoffContext = buildHandoffContext({
        sourceAgentName: agent.name,
        messages: normalizedMessages,
        summary: existingConv?.summary
      })
    } else {
      // New handoff — validate and record
      const validation = await validateHandoff({
        sourceAgent: agent,
        targetAgentId: payload.handoffAgentId,
        handoffChain: chain
      })

      if (!validation.valid || !validation.targetAgent) {
        return NextResponse.json(
          { error: validation.error ?? 'Handoff not allowed' },
          { status: 400 }
        )
      }

      activeAgent = validation.targetAgent
      handoffContext = buildHandoffContext({
        sourceAgentName: agent.name,
        messages: normalizedMessages,
        summary: existingConv?.summary
      })

      await recordConversationHandoff(
        agent.tenantId!,
        agent.id,
        conversation.id,
        {
          fromAgentId: agent.id,
          fromAgentName: agent.name,
          toAgentId: activeAgent.id,
          toAgentName: activeAgent.name
        }
      )
    }
  }

  // Resolve handoff target names for the active agent's system prompt
  if (activeAgent.handoffTargets?.length) {
    handoffTargetNames = await getAgentNames(activeAgent.handoffTargets)
  }

  // Build messages for the agent — inject handoff context if this is a continuation
  const agentMessages = handoffContext
    ? [
        { id: nanoid(), role: 'system' as const, content: handoffContext },
        ...normalizedMessages
      ]
    : normalizedMessages

  // Count assistant responses for max responses check
  // +1 for the response being streamed, -1 to exclude the greeting message
  const assistantCount =
    normalizedMessages.filter(m => m.role === 'assistant').length

  // Calculate remaining responses so the AI can wrap up gracefully
  const remainingResponses = agent.maxResponses
    ? agent.maxResponses - assistantCount + 1
    : null

  const stream = await runAgentStream({
    agent: activeAgent,
    messages: agentMessages,
    handoffTargetNames,
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

      // Record agent-to-agent handoff if detected in stream
      if (reason === 'handoff_to_agent') {
        const targetId = extractHandoffTarget(completion)
        if (targetId) {
          const targetName = handoffTargetNames[targetId] ?? targetId
          await recordConversationHandoff(
            agent.tenantId!,
            agent.id,
            conversation.id,
            {
              fromAgentId: activeAgent.id,
              fromAgentName: activeAgent.name,
              toAgentId: targetId,
              toAgentName: targetName
            }
          )
        }
      }

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
    assistantCount,
    handoffTargetNames
  )

  return new StreamingTextResponse(transformedStream, {
    headers: {
      'x-conversation-id': conversation.id,
      'x-agent-mode': activeAgent.mode,
      'x-max-responses': String(agent.maxResponses ?? ''),
      'x-max-agent-responses': String(agent.maxAgentResponses ?? ''),
      'x-total-response-count': String((agent.totalResponseCount ?? 0) + 1),
      'x-agent-id': activeAgent.id,
      'x-agent-name': activeAgent.name
    }
  })
}
