import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  getHookById,
  verifySecret,
  recordHookUsage
} from '@vibesboard/agents/hooks'
import { getAgentById } from '@vibesboard/agents/server'
import { createJob, runJobAsync } from '@vibesboard/agents/hook-jobs'
import { assertSafeCallbackUrl } from '@vibesboard/agents/webhook-utils'
import { checkUsageLimit, usageLimitResponse } from '@/lib/usage'

export const runtime = 'nodejs'

const asyncChatSchema = z.object({
  message: z.string().min(1).max(10_000).trim(),
  callbackUrl: z.string().url(),
  externalUserId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^.]+$/, 'must not contain dots')
    .optional(),
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

  // ── 3b. Reject an unreachable callback before accepting the job ───────
  // This same check runs again inside runJobAsync (and safeFetch re-validates
  // after DNS resolution, which a literal check can't cover). Running it here
  // too is what makes the 202 honest: previously a blocked URL — loopback,
  // link-local, a private range — was accepted, and the caller got a job id
  // and success for work that could never be delivered.
  try {
    assertSafeCallbackUrl(callbackUrl)
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Invalid callbackUrl',
        message:
          err instanceof Error ? err.message : 'callbackUrl is not reachable'
      },
      { status: 422 }
    )
  }

  // ── 3c. Refuse work already over the tenant's usage limit ─────────────
  // /chat and /stream check this before running. /async did not, so it
  // returned 202 with a job id and then failed in the background where the
  // caller couldn't see it — the same "success for work that cannot succeed"
  // shape as the callback-URL bug above.
  const usageCheck = await checkUsageLimit(agent.tenantId!)
  if (!usageCheck.allowed) {
    return usageLimitResponse(usageCheck)
  }

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
