import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getHookById, verifySecret, recordHookUsage } from '@/lib/agents/hooks'
import { getAgentById } from '@/lib/agents/server'
import { createJob, runJobAsync } from '@/lib/agents/hook-jobs'

export const runtime = 'nodejs'

const asyncChatSchema = z.object({
  message: z.string().min(1).max(10_000).trim(),
  callbackUrl: z.string().url(),
  externalUserId: z.string().min(1).max(256).optional(),
  conversationId: z.string().min(1).optional()
})

/**
 * POST /api/hooks/{hookId}/async
 *
 * Fire-and-forget variant of the hook chat endpoint. Returns 202 immediately
 * with a jobId. The agent runs in the background and POSTs the reply to
 * callbackUrl when complete.
 *
 * Authentication: X-Hook-Secret header (same as /chat and /stream).
 *
 * Request body:
 *   message       — the message to send to the agent
 *   callbackUrl   — where to POST the reply when the agent finishes
 *   externalUserId — optional: scopes conversation context (same as /chat)
 *   conversationId — optional: resume a specific conversation
 *
 * Response (202):
 *   { jobId, status: "pending", conversationId?, agentId, hookId }
 *
 * Callback payload (POST to callbackUrl):
 *   {
 *     jobId, hookId, agentId, status: "completed" | "failed",
 *     reply?, error?, conversationId
 *   }
 *
 * Callback headers:
 *   X-Hook-Signature  — HMAC-SHA256(hookSecret, JSON.stringify(payload))
 *   X-Hook-Attempt    — delivery attempt number (1-3)
 *
 * Poll for status:
 *   GET /api/hooks/{hookId}/jobs/{jobId}
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

  const parsed = asyncChatSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { message, callbackUrl, externalUserId, conversationId } = parsed.data

  // ── 4. Create job ─────────────────────────────────────────────────────
  const job = await createJob({
    hookId,
    agentId: agent.id,
    tenantId: agent.tenantId!,
    message,
    callbackUrl,
    externalUserId,
    conversationId
  })

  // ── 5. Fire background execution via after() ─────────────────────────
  // next/server after() keeps the background task alive after the response
  // is sent — critical on Cloud Run where the process would otherwise be
  // frozen/killed once the HTTP response completes.
  after(async () => {
    try {
      await runJobAsync(job, rawSecret)
    } catch (err) {
      console.error('[hook/async] Unhandled job error:', err)
    }
  })

  // ── 6. Record usage (fire-and-forget) ─────────────────────────────────
  recordHookUsage(agent.tenantId!, agent.id, hookId)

  // ── 7. Return 202 immediately ─────────────────────────────────────────
  return NextResponse.json(
    {
      jobId: job.id,
      status: 'pending',
      agentId: agent.id,
      hookId
    },
    { status: 202 }
  )
}
