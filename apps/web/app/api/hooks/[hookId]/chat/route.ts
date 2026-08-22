import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Message } from '@vibesboard/contracts'

import {
  getHookById,
  verifySecret,
  recordHookUsage
} from '@vibesboard/agents/hooks'
import { incrementAgentResponseCount } from '@vibesboard/agents/limits'
import { getAgentById, getAgentNamesByTenant } from '@vibesboard/agents/server'
import {
  ensureConversation,
  updateConversationMessages,
  getConversation,
  recordConversationHandoff
} from '@vibesboard/agents/conversations'
import { maybeAutoSummarize } from '@vibesboard/agents/auto-summarize'
import { runAgentStream } from '@vibesboard/ai/runtime'
import {
  detectCompletionMarker,
  extractHandoffTarget,
  stripCompletionMarkers
} from '@vibesboard/ai/completion'
import { nanoid } from '@vibesboard/utils'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from '@vibesboard/agents/notifications'
import {
  validateHandoff,
  buildHandoffContext,
  MAX_HANDOFF_DEPTH
} from '@vibesboard/ai/handoff'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'
import { OPENAI_CHAT_MODEL } from '@vibesboard/adapter-openai'

export const runtime = 'nodejs'

const hookChatSchema = z.object({
  message: z.string().min(1).max(10_000).trim(),
  externalUserId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^.]+$/, 'must not contain dots')
    .optional(),
  conversationId: z.string().min(1).optional()
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hookId: string }> }
) {
  const { hookId } = await params

  // ── 1. Secret authentication ─────────────────────────────────────────
  const rawSecret = req.headers.get('x-hook-secret')
  if (!rawSecret) {
    return new NextResponse('Missing X-Hook-Secret header', { status: 401 })
  }

  const hook = await getHookById(hookId)
  if (!hook) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (hook.status !== 'active') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (!verifySecret(rawSecret, hook.secretHash)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // ── 2. Load agent ────────────────────────────────────────────────────
  const agent = await getAgentById(hook.agentId)
  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  // ── 3. Parse and validate request body ──────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Invalid JSON body', { status: 400 })
  }

  const parsed = hookChatSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { message, externalUserId, conversationId } = parsed.data

  // ── 4. Ensure conversation ───────────────────────────────────────────
  const userMessage = { id: nanoid(), role: 'user' as const, content: message }

  const conversation = await ensureConversation({
    tenantId: agent.tenantId!,
    agentId: agent.id,
    conversationId,
    userId: null,
    externalId: externalUserId ?? hookId,
    initialMessages: [userMessage]
  })

  const priorMessages = conversation.messages ?? []
  let allMessages: Message[] = priorMessages.some(m => m.id === userMessage.id)
    ? priorMessages
    : [...priorMessages, userMessage]

  // ── 5. Check tenant usage limit ────────────────────────────────────
  const usageCheck = await checkUsageLimit(agent.tenantId!)
  if (!usageCheck.allowed) {
    return usageLimitResponse(usageCheck)
  }

  // ── 6. Run agent with handoff loop ─────────────────────────────────
  let currentAgent = agent
  let reply = ''

  for (let depth = 0; depth <= MAX_HANDOFF_DEPTH; depth++) {
    reply = ''
    let handoffTargetId: string | null = null

    // Re-check usage limit on each handoff hop (except first — already checked)
    if (depth > 0) {
      const hopCheck = await checkUsageLimit(agent.tenantId!)
      if (!hopCheck.allowed) return usageLimitResponse(hopCheck)
    }

    // Resolve handoff target names for the current agent
    let handoffTargetNames: Record<string, string> = {}
    if (currentAgent.handoffTargets?.length) {
      handoffTargetNames = await getAgentNamesByTenant(
        agent.tenantId!,
        currentAgent.handoffTargets
      )
    }

    const stream = await runAgentStream({
      agent: currentAgent,
      messages: allMessages,
      handoffTargetNames,
      onCompletion: async (
        completion: string,
        usage?: { promptTokens: number; completionTokens: number }
      ) => {
        const reason = detectCompletionMarker(completion)
        handoffTargetId = extractHandoffTarget(completion)
        reply = stripCompletionMarkers(completion)

        const nextMessages = [
          ...allMessages,
          { id: nanoid(), role: 'assistant' as const, content: reply }
        ]
        await updateConversationMessages({
          tenantId: agent.tenantId!,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          respondingAgentId: currentAgent.id
        })

        maybeAutoSummarize({
          tenantId: agent.tenantId!,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          currentSummary: conversation.summary,
          summaryResponseCount: conversation.summaryResponseCount,
          responseCounts: conversation.responseCounts
        }).catch(err =>
          console.error('[hook-chat] Auto-summarize failed:', err)
        )

        // Increment current agent's lifetime response counter
        incrementAgentResponseCount(
          currentAgent.tenantId!,
          currentAgent.id
        ).catch((e: unknown) =>
          console.error('[hooks] Failed to increment response count:', e)
        )

        // Record usage for metering (fire-and-forget)
        await recordUsage({
          tenantId: agent.tenantId!,
          agentId: currentAgent.id,
          conversationId: conversation.id,
          userId: null,
          externalId: externalUserId ?? hookId,
          source: 'hook_chat',
          model: OPENAI_CHAT_MODEL,
          inputTokens: usage?.promptTokens,
          outputTokens: usage?.completionTokens
        })

        const event = mapCompletionToEvent(reason)
        if (event) {
          dispatchAgentNotification({
            agent: currentAgent,
            conversationId: conversation.id,
            event,
            messageCount: allMessages.filter(m => m.role === 'user').length
          })
        }
      }
    })

    // Drain the stream to trigger onCompletion
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // Check if we need to hand off to another agent
    if (!handoffTargetId) break

    const existingConv = await getConversation(
      agent.tenantId!,
      agent.id,
      conversation.id
    )
    const validation = await validateHandoff({
      sourceAgent: currentAgent,
      targetAgentId: handoffTargetId,
      handoffChain: existingConv?.handoffChain ?? []
    })

    if (!validation.valid || !validation.targetAgent) {
      console.warn(`[hooks] Handoff validation failed: ${validation.error}`)
      break
    }

    // Record the handoff
    await recordConversationHandoff(
      agent.tenantId!,
      agent.id,
      conversation.id,
      {
        fromAgentId: currentAgent.id,
        fromAgentName: currentAgent.name,
        toAgentId: validation.targetAgent.id,
        toAgentName: validation.targetAgent.name
      }
    )

    // Append the assistant reply so the next agent sees what the current agent said
    allMessages = [
      ...allMessages,
      { id: nanoid(), role: 'assistant' as const, content: reply }
    ]

    // Build context for the target agent and continue the loop
    const context = buildHandoffContext({
      sourceAgentName: currentAgent.name,
      messages: allMessages,
      summary: existingConv?.summary
    })

    // Replace allMessages with just the context + original user/assistant messages
    // (avoid accumulating redundant system messages on each hop)
    const nonSystemMessages = allMessages.filter(m => m.role !== 'system')
    allMessages = [
      { id: nanoid(), role: 'system' as const, content: context },
      ...nonSystemMessages
    ]
    currentAgent = validation.targetAgent
  }

  // ── 7. Record hook usage (fire-and-forget) ──────────────────────────
  recordHookUsage(agent.tenantId!, agent.id, hookId).catch(e =>
    console.error('[hooks] Failed to record hook usage:', e)
  )

  // ── 8. Return JSON response ──────────────────────────────────────────
  return NextResponse.json({
    reply,
    conversationId: conversation.id,
    agentId: currentAgent.id,
    hookId
  })
}
