import { NextRequest, NextResponse } from 'next/server'
import { type Message } from '@vibesboard/contracts'

import { getAgentById, getAgentNamesByTenant } from '@vibesboard/agents/server'
import { publicAgentChatRequestSchema } from '@vibesboard/agents/schema'
import {
  ensureConversation,
  updateConversationMessages,
  getConversation,
  recordConversationHandoff
} from '@vibesboard/agents/conversations'
import { maybeAutoSummarize } from '@vibesboard/agents/auto-summarize'
import { runAgentStream } from '@vibesboard/ai/runtime'
import { ensureExternalSessionId } from '@/lib/agent-cookies'
import { hasValidAccessCookie } from '@/lib/access-gate'
import { nanoid } from '@vibesboard/utils'
import {
  detectCompletionMarker,
  extractHandoffTarget,
  stripCompletionMarkers,
  wrapStreamWithCompletionDetection
} from '@vibesboard/ai/completion'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from '@vibesboard/agents/notifications'
import { validateHandoff, buildHandoffContext } from '@vibesboard/ai/handoff'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'
import {
  incrementAgentResponseCount,
  reserveAgentResponseSlot
} from '@vibesboard/agents/limits'
import { OPENAI_CHAT_MODEL } from '@vibesboard/adapter-openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bump the active agent's lifetime response counter (fire-and-forget).
 * Near the cap, reserve a slot atomically (conditional UPDATE) to avoid
 * serving over the limit under concurrency; otherwise a plain atomic increment.
 */
function bumpActiveAgentResponseCount(activeAgent: {
  id: string
  tenantId?: string | null
  totalResponseCount?: number | null
  maxAgentResponses?: number | null
}): void {
  const tenantId = activeAgent.tenantId!
  const onError = (e: unknown) =>
    console.error('[chat] Failed to increment response count:', e)
  const nearCap =
    activeAgent.maxAgentResponses &&
    (activeAgent.totalResponseCount ?? 0) + 5 >= activeAgent.maxAgentResponses
  if (nearCap) {
    reserveAgentResponseSlot(
      tenantId,
      activeAgent.id,
      activeAgent.maxAgentResponses!
    ).catch(onError)
  } else {
    incrementAgentResponseCount(tenantId, activeAgent.id).catch(onError)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params
    const agent = await getAgentById(agentId)

    if (!agent) {
      return new NextResponse('Agent not found', { status: 404 })
    }

    if (!agent.allowAnonymous) {
      const hasAccess = await hasValidAccessCookie(agentId)
      if (!hasAccess) {
        return new NextResponse('Agent does not allow anonymous chat', {
          status: 403
        })
      }
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

    // Determine which agent actually handles this request
    let activeAgent = agent
    let handoffContext: string | undefined
    let handoffTargetNames: Record<string, string> = {}

    // If client requested handoff to another agent
    if (payload.handoffAgentId) {
      const existingConv = await getConversation(
        tenantId,
        agent.id,
        conversation.id
      )
      const chain = existingConv?.handoffChain ?? []
      const lastEntry = chain[chain.length - 1]
      const isContinuation = lastEntry?.toAgentId === payload.handoffAgentId

      if (isContinuation) {
        // This is a continuation — the handoff was already recorded.
        // Just load the target agent and route to it.
        const targetAgent = await getAgentById(payload.handoffAgentId)
        if (!targetAgent) {
          return NextResponse.json(
            { error: 'Target agent not found' },
            { status: 404 }
          )
        }
        if (!targetAgent.allowAnonymous) {
          const hasAccess = await hasValidAccessCookie(targetAgent.id)
          if (!hasAccess) {
            return NextResponse.json(
              { error: 'Target agent does not allow anonymous chat' },
              { status: 403 }
            )
          }
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

        // Target agent must also allow anonymous for public endpoint
        if (!validation.targetAgent.allowAnonymous) {
          const hasAccess = await hasValidAccessCookie(
            validation.targetAgent.id
          )
          if (!hasAccess) {
            return NextResponse.json(
              { error: 'Target agent does not allow anonymous chat' },
              { status: 403 }
            )
          }
        }

        activeAgent = validation.targetAgent
        handoffContext = buildHandoffContext({
          sourceAgentName: agent.name,
          messages: normalizedMessages,
          summary: existingConv?.summary
        })

        await recordConversationHandoff(tenantId, agent.id, conversation.id, {
          fromAgentId: agent.id,
          fromAgentName: agent.name,
          toAgentId: activeAgent.id,
          toAgentName: activeAgent.name
        })
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
      handoffTargetNames = await getAgentNamesByTenant(
        tenantId,
        activeAgent.handoffTargets
      )
    }

    const agentMessages = handoffContext
      ? [
          { id: nanoid(), role: 'system' as const, content: handoffContext },
          ...normalizedMessages
        ]
      : normalizedMessages

    // Use per-agent response counts from the conversation document
    const agentResponseCount =
      conversation.responseCounts?.[activeAgent.id] ?? 0

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
          tenantId,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          respondingAgentId: activeAgent.id
        })

        maybeAutoSummarize({
          tenantId,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          currentSummary: conversation.summary,
          summaryResponseCount: conversation.summaryResponseCount,
          responseCounts: conversation.responseCounts,
          tokenUsage: usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } : undefined,
        }).catch(err =>
          console.error('[public-chat] Auto-summarize failed:', err)
        )

        if (reason === 'handoff_to_agent') {
          const targetId = extractHandoffTarget(completion)
          if (targetId) {
            const existingConvForHandoff = await getConversation(
              tenantId,
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
                tenantId,
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

        // Increment active agent's lifetime response counter (fire-and-forget).
        bumpActiveAgentResponseCount(activeAgent)

        // Record usage for metering (fire-and-forget)
        recordUsage({
          tenantId,
          agentId: activeAgent.id,
          conversationId: conversation.id,
          userId: null,
          externalId: externalId,
          source: isEmbed ? 'embed' : 'public_chat',
          model: OPENAI_CHAT_MODEL,
          inputTokens: usage?.promptTokens,
          outputTokens: usage?.completionTokens
        })

        // Response counts for handoff target agents are maintained by
        // updateConversationMessages(respondingAgentId); derived handoff refs
        // read them directly, so no separate ref update is needed.

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
        'Cache-Control': 'no-cache, no-transform',
        'Content-Encoding': 'identity',
        'X-Accel-Buffering': 'no',
        'x-conversation-id': conversation.id,
        'x-agent-mode': activeAgent.mode,
        'x-max-responses': String(activeAgent.maxResponses ?? ''),
        'x-max-agent-responses': String(activeAgent.maxAgentResponses ?? ''),
        'x-total-response-count': String(
          (activeAgent.totalResponseCount ?? 0) + 1
        ),
        'x-agent-id': activeAgent.id,
        'x-agent-name': activeAgent.name,
        'x-remaining-responses': String(currentRemainingResponses ?? '')
      }
    })
  } catch (err) {
    console.error('[public-chat] handler failed:', err)
    return NextResponse.json(
      { error: 'Chat request failed. Please try again.' },
      { status: 500 }
    )
  }
}
