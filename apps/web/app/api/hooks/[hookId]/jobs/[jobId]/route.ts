import { NextRequest, NextResponse } from 'next/server'

import { getHookById, verifySecret } from '@vibesboard/agents/hooks'
import { getJob } from '@vibesboard/agents/hook-jobs'

export const runtime = 'nodejs'

/**
 * GET /api/hooks/{hookId}/jobs/{jobId}
 *
 * Poll the status of an async hook job.
 * Authentication: X-Hook-Secret header (same secret used to submit the job).
 *
 * Response:
 *   {
 *     jobId, hookId, agentId, status,
 *     reply?,        — present when status === "completed"
 *     error?,        — present when status === "failed"
 *     conversationId?,
 *     callbackStatus?,   — HTTP status from last callback delivery attempt
 *     callbackAttempts,
 *     createdAt, startedAt?, completedAt?, failedAt?
 *   }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hookId: string; jobId: string }> }
) {
  const { hookId, jobId } = await params

  // ── 1. Secret authentication ──────────────────────────────────────────
  const rawSecret = req.headers.get('x-hook-secret')
  if (!rawSecret) {
    return new NextResponse('Missing X-Hook-Secret header', { status: 401 })
  }

  const hook = await getHookById(hookId)
  if (!hook) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Matches the three runtime routes. Without it, disabling a hook stopped
  // new work but left every existing job id readable with the same secret —
  // including its completed reply text — so "disable" was not the revocation
  // an operator would reasonably expect it to be.
  if (hook.status !== 'active') {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  if (!verifySecret(rawSecret, hook.secretHash)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // ── 2. Load job ───────────────────────────────────────────────────────
  const job = await getJob(hook.tenantId, hook.agentId, hookId, jobId)
  if (!job) {
    return new NextResponse('Job not found', { status: 404 })
  }

  // ── 3. Return safe job view (exclude internal fields) ─────────────────
  return NextResponse.json({
    jobId: job.id,
    hookId: job.hookId,
    agentId: job.agentId,
    status: job.status,
    ...(job.reply !== undefined && { reply: job.reply }),
    ...(job.error !== undefined && { error: job.error }),
    ...(job.conversationId && { conversationId: job.conversationId }),
    ...(job.callbackStatus !== undefined && {
      callbackStatus: job.callbackStatus
    }),
    callbackAttempts: job.callbackAttempts,
    createdAt: job.createdAt,
    ...(job.startedAt && { startedAt: job.startedAt }),
    ...(job.completedAt && { completedAt: job.completedAt }),
    ...(job.failedAt && { failedAt: job.failedAt })
  })
}
