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
  recordConversationHandoff,
  updateConversationRef
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
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'
import { OPENAI_CHAT_MODEL } from '@/lib/openai'

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

  // Check tenant usage limit
  const usageCheck = await checkUsageLimit(agent.tenantId!)
  if (!usageCheck.allowed) {
    return usageLimitResponse(usageCheck)
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

  // Check active agent's lifetime limit
  if (
    activeAgent.id !== agent.id &&
    activeAgent.maxAgentResponses &&
    (activeAgent.totalResponseCount ?? 0) >= activeAgent.maxAgentResponses
  ) {
    return NextResponse.json(
      { error: 'Agent response limit reached', code: 'AGENT_LIMIT_REACHED' },
      { status: 403 }
    )
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

  // Use per-agent response counts from the conversation document
  const agentResponseCount = conversation.responseCounts?.[activeAgent.id] ?? 0

  // Calculate remaining responses using the active agent's config
  const remainingResponses = activeAgent.maxResponses
    ? activeAgent.maxResponses - agentResponseCount
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
        summary: null,
        respondingAgentId: activeAgent.id
      })

      // Record agent-to-agent handoff if detected in stream (validate first)
      if (reason === 'handoff_to_agent') {
        const targetId = extractHandoffTarget(completion)
        if (targetId) {
          const existingConvForHandoff = await getConversation(
            agent.tenantId!,
            agent.id,
            conversation.id
          )
          const validation = await validateHandoff({
            sourceAgent: activeAgent,
            targetAgentId: targetId,
            handoffChain: existingConvForHandoff?.handoffChain ?? []
          })
          if (validation.valid && validation.targetAgent) {
            await recordConversationHandoff(
              agent.tenantId!,
              agent.id,
              conversation.id,
              {
                fromAgentId: activeAgent.id,
                fromAgentName: activeAgent.name,
                toAgentId: validation.targetAgent.id,
                toAgentName: validation.targetAgent.name
              }
            )
          }
        }
      }

      // Increment active agent's lifetime response counter
      if (
        activeAgent.maxAgentResponses &&
        (activeAgent.totalResponseCount ?? 0) + 5 >= activeAgent.maxAgentResponses
      ) {
        // Near limit — use transaction for accuracy
        const agentRef = adminDb
          .collection(Collections.agents(activeAgent.tenantId!))
          .doc(activeAgent.id)
        adminDb.runTransaction(async (tx: any) => {
          const snap = await tx.get(agentRef)
          const current = (snap.data() as Record<string, any> | undefined)?.totalResponseCount ?? 0
          tx.update(agentRef, { totalResponseCount: current + 1 })
        }).catch((e: unknown) =>
          console.error('[chat] Failed to increment response count (tx):', e)
        )
      } else {
        adminDb
          .collection(Collections.agents(activeAgent.tenantId!))
          .doc(activeAgent.id)
          .update({ totalResponseCount: FieldValue.increment(1) })
          .catch((e: unknown) =>
            console.error('[chat] Failed to increment response count:', e)
          )
      }

      // Record usage for metering (fire-and-forget)
      recordUsage({
        tenantId: agent.tenantId!,
        agentId: activeAgent.id,
        conversationId: conversation.id,
        userId: user.id,
        source: 'chat',
        model: OPENAI_CHAT_MODEL,
      })

      // Update conversation ref if this is a handoff target agent
      if (activeAgent.id !== agent.id) {
        updateConversationRef(
          agent.tenantId!,
          activeAgent.id,
          conversation.id,
          {
            responseCount: agentResponseCount + 1,
            lastMessageAt: new Date().toISOString()
          }
        ).catch(err =>
          console.error('[chat] Failed to update conversation ref:', err)
        )
      }

      const event = mapCompletionToEvent(reason)
      if (event) {
        dispatchAgentNotification({
          agent: activeAgent,
          conversationId: conversation.id,
          event,
          messageCount: agentResponseCount
        })
      }
    }
  })

  const transformedStream = wrapStreamWithCompletionDetection(
    stream,
    activeAgent.maxResponses,
    agentResponseCount,
    handoffTargetNames
  )

  const currentRemainingResponses = activeAgent.maxResponses
    ? activeAgent.maxResponses - agentResponseCount - 1
    : null

  return new StreamingTextResponse(transformedStream, {
    headers: {
      'x-conversation-id': conversation.id,
      'x-agent-mode': activeAgent.mode,
      'x-max-responses': String(activeAgent.maxResponses ?? ''),
      'x-max-agent-responses': String(activeAgent.maxAgentResponses ?? ''),
      'x-total-response-count': String((activeAgent.totalResponseCount ?? 0) + 1),
      'x-agent-id': activeAgent.id,
      'x-agent-name': activeAgent.name,
      'x-remaining-responses': String(currentRemainingResponses ?? '')
    }
  })
}
