import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getHookById, verifySecret, recordHookUsage } from '@/lib/agents/hooks'
import { getAgentById } from '@/lib/agents/server'
import { ensureConversation, updateConversationMessages } from '@/lib/agents/conversations'
import { runAgentStream } from '@/lib/agent/runtime'
import { stripCompletionMarkers } from '@/lib/agent/completion'
import { nanoid } from '@/lib/utils'

export const runtime = 'nodejs'

const hookChatSchema = z.object({
  message: z.string().min(1).max(10_000).trim(),
  externalUserId: z.string().min(1).max(256).optional(),
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
    // Return 401 not 404 to avoid leaking hook existence
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
  // externalUserId scopes the conversation to a session — the external
  // orchestrator passes a stable session ID so the agent retains context
  // across turns within that session.
  const userMessage = { id: nanoid(), role: 'user' as const, content: message }

  const conversation = await ensureConversation({
    tenantId: agent.tenantId!,
    agentId: agent.id,
    conversationId,
    userId: null,
    externalId: externalUserId ?? hookId,
    initialMessages: [userMessage]
  })

  // Reconstruct full message history for the runtime
  const priorMessages = conversation.messages ?? []
  const allMessages = priorMessages.some(m => m.id === userMessage.id)
    ? priorMessages
    : [...priorMessages, userMessage]

  // ── 5. Run agent and collect full completion ─────────────────────────
  let reply = ''

  const stream = await runAgentStream({
    agent,
    messages: allMessages,
    onCompletion: async (completion: string) => {
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
        summary: null
      })
    }
  })

  // Drain the stream to trigger onCompletion
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }

  // ── 6. Record usage (fire-and-forget) ────────────────────────────────
  recordHookUsage(agent.tenantId!, agent.id, hookId)

  // ── 7. Return JSON response ──────────────────────────────────────────
  return NextResponse.json({
    reply,
    conversationId: conversation.id,
    agentId: agent.id,
    hookId
  })
}
