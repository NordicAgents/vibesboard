import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getHookById, verifySecret, recordHookUsage } from '@/lib/agents/hooks'
import { getAgentById } from '@/lib/agents/server'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { maybeAutoSummarize } from '@/lib/agents/auto-summarize'
import { runAgentStream } from '@/lib/agent/runtime'
import { stripCompletionMarkers } from '@/lib/agent/completion'
import { nanoid } from '@/lib/utils'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'
import { OPENAI_CHAT_MODEL } from '@/lib/openai'

export const runtime = 'nodejs'

const hookStreamSchema = z.object({
  message: z.string().min(1).max(10_000).trim(),
  externalUserId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^.]+$/, 'must not contain dots')
    .optional(),
  conversationId: z.string().min(1).optional()
})

/**
 * POST /api/hooks/{hookId}/stream
 *
 * Streaming variant of the hook chat endpoint. Returns a text/event-stream
 * (SSE) response so callers can render tokens as they arrive.
 *
 * Authentication: X-Hook-Secret header (same as /chat).
 *
 * SSE event format:
 *   data: <token text>\n\n          — one or more token chunks
 *   data: [DONE] {"conversationId":"...","agentId":"...","hookId":"..."}\n\n
 *
 * Response headers:
 *   x-conversation-id  — conversation ID (also in the [DONE] event)
 *   x-agent-id         — agent ID
 *
 * Usage example:
 *   const res = await fetch('/api/hooks/hk_abc/stream', {
 *     method: 'POST',
 *     headers: { 'X-Hook-Secret': '<secret>', 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ message: 'Hello', externalUserId: 'session_001' })
 *   })
 *   const reader = res.body.getReader()
 *   // parse SSE chunks from reader
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hookId: string }> }
) {
  const { hookId } = await params

  // ── 1. Secret authentication ──────────────────────────────────────────
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

  // ── 2. Load agent ─────────────────────────────────────────────────────
  const agent = await getAgentById(hook.agentId)
  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Invalid JSON body', { status: 400 })
  }

  const parsed = hookStreamSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { message, externalUserId, conversationId } = parsed.data

  // ── 4. Check tenant usage limit ──────────────────────────────────────
  const usageCheck = await checkUsageLimit(agent.tenantId!)
  if (!usageCheck.allowed) {
    return usageLimitResponse(usageCheck)
  }

  // ── 5. Ensure conversation ────────────────────────────────────────────
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
  const allMessages = priorMessages.some(m => m.id === userMessage.id)
    ? priorMessages
    : [...priorMessages, userMessage]

  // ── 5. Build SSE stream ───────────────────────────────────────────────
  const encoder = new TextEncoder()

  const sseStream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) =>
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))

      try {
        const agentStream = await runAgentStream({
          agent,
          messages: allMessages,
          onCompletion: async (
            completion: string,
            usage?: { promptTokens: number; completionTokens: number }
          ) => {
            const cleaned = stripCompletionMarkers(completion)
            const nextMessages = [
              ...allMessages,
              { id: nanoid(), role: 'assistant' as const, content: cleaned }
            ]
            await updateConversationMessages({
              tenantId: agent.tenantId!,
              agentId: agent.id,
              conversationId: conversation.id,
              messages: nextMessages
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
              console.error('[hook-stream] Auto-summarize failed:', err)
            )

            // Record usage for metering (fire-and-forget)
            recordUsage({
              tenantId: agent.tenantId!,
              agentId: agent.id,
              conversationId: conversation.id,
              userId: null,
              externalId: externalUserId ?? hookId,
              source: 'hook_stream',
              model: OPENAI_CHAT_MODEL,
              inputTokens: usage?.promptTokens,
              outputTokens: usage?.completionTokens
            })
          }
        })

        // Stream tokens to the client as SSE data events
        const reader = agentStream.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          if (chunk) enqueue(chunk)
        }

        // Final event — signals end of stream with metadata
        enqueue(
          `[DONE] ${JSON.stringify({
            conversationId: conversation.id,
            agentId: agent.id,
            hookId
          })}`
        )
      } catch (err) {
        // Emit an error event before closing so the client can detect failures
        enqueue(
          `[ERROR] ${JSON.stringify({
            message: err instanceof Error ? err.message : 'Stream error'
          })}`
        )
      } finally {
        controller.close()
        // Record usage fire-and-forget
        recordHookUsage(agent.tenantId!, agent.id, hookId)
      }
    }
  })

  // ── 6. Return SSE response ────────────────────────────────────────────
  return new NextResponse(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-conversation-id': conversation.id,
      'x-agent-id': agent.id
    }
  })
}
