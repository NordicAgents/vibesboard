import { type Message } from '@/lib/types/message'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { getAgentById, getAgentNamesByTenant } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages,
  getConversation,
  recordConversationHandoff,
  updateConversationRef
} from '@/lib/agents/conversations'
import { maybeAutoSummarize } from '@/lib/agents/auto-summarize'
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
import { reserveAgentResponseSlot } from '@/lib/agents/limits'
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
      // Prevent cross-tenant handoff continuations — target must be in the same workspace
      if (targetAgent.tenantId !== agent.tenantId) {
        return NextResponse.json({ error: 'Target agent is in a different workspace' }, { status: 403 })
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

  // Atomically reserve a response slot for the agent that will actually handle
  // this request. This covers both the non-handoff case (activeAgent === agent)
  // and the handoff case, and prevents concurrent requests from racing past
  // the limit check.
  if (activeAgent.maxAgentResponses) {
    const slotReserved = await reserveAgentResponseSlot(
      activeAgent.tenantId!,
      activeAgent.id,
      activeAgent.maxAgentResponses
    )
    if (!slotReserved) {
      return NextResponse.json(
        { error: 'Agent response limit reached', code: 'AGENT_LIMIT_REACHED' },
        { status: 403 }
      )
    }
  }

  // Resolve handoff target names for the active agent's system prompt.
  // Handoff targets are always in the same tenant, so use the batched tenant-scoped
  // lookup (single Firestore getAll RPC) instead of N collectionGroup queries.
  if (activeAgent.handoffTargets?.length) {
    handoffTargetNames = await getAgentNamesByTenant(activeAgent.tenantId!, activeAgent.handoffTargets)
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
    onCompletion: async (completion, usage) => {
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
        respondingAgentId: activeAgent.id
      })

      maybeAutoSummarize({
        tenantId: agent.tenantId!,
        agentId: agent.id,
        conversationId: conversation.id,
        messages: nextMessages,
        currentSummary: conversation.summary,
        summaryResponseCount: conversation.summaryResponseCount,
        responseCounts: conversation.responseCounts
      }).catch(err => console.error('[chat] Auto-summarize failed:', err))

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

      // Capped agents (maxAgentResponses set) had their slot reserved atomically
      // before the stream started — do not double-count here.
      // Uncapped agents increment here; await so the write completes before the
      // function context is reclaimed by the serverless runtime.
      if (!activeAgent.maxAgentResponses) {
        await adminDb
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
        inputTokens: usage?.promptTokens,
        outputTokens: usage?.completionTokens,
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

  return new Response(transformedStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
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
