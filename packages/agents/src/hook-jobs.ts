import 'server-only'
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { hookJobs, type HookJob } from '@vibesboard/adapter-postgres/schema'
import {
  type HookJobDocument,
  type HookJobStatus
} from '@vibesboard/contracts'
import { rowToHookJob } from './db.ts'
import { getAgentById } from '@vibesboard/agents/server'
import {
  ensureConversation,
  updateConversationMessages
} from '@vibesboard/agents/conversations'
import { maybeAutoSummarize } from '@vibesboard/agents/auto-summarize'
import { runAgentStream } from '@vibesboard/ai/runtime'
import {
  detectCompletionMarker,
  stripCompletionMarkers
} from '@vibesboard/ai/completion'
import { nanoid } from '@vibesboard/utils'
import { assertSafeCallbackUrl, signPayload } from './webhook-utils.ts'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from './notifications.ts'
import { checkUsageLimit, recordUsage } from '@vibesboard/policy/usage'
import { OPENAI_CHAT_MODEL } from '@vibesboard/adapter-openai'

type Db = PostgresJsDatabase<typeof schema>

// ─── DB helpers ───────────────────────────────────────────────────────

export async function createJob(
  params: {
    hookId: string
    agentId: string
    tenantId: string
    message: string
    callbackUrl: string
    externalUserId?: string
    conversationId?: string
  },
  db: Db = getMigrateDb()
): Promise<HookJobDocument> {
  const [row] = await db
    .insert(hookJobs)
    .values({
      id: uuidv7(),
      hookId: params.hookId,
      agentId: params.agentId,
      tenantId: params.tenantId,
      message: params.message,
      callbackUrl: params.callbackUrl,
      externalUserId: params.externalUserId ?? null,
      conversationId: params.conversationId ?? null,
      status: 'pending',
      callbackAttempts: 0
    })
    .returning()
  return rowToHookJob(row)
}

export async function getJob(
  tenantId: string,
  agentId: string,
  hookId: string,
  jobId: string,
  db: Db = getMigrateDb()
): Promise<HookJobDocument | null> {
  const [row] = await db
    .select()
    .from(hookJobs)
    .where(
      and(
        eq(hookJobs.id, jobId),
        eq(hookJobs.tenantId, tenantId),
        eq(hookJobs.agentId, agentId),
        eq(hookJobs.hookId, hookId)
      )
    )
    .limit(1)
  return row ? rowToHookJob(row) : null
}

type JobPatch = Partial<{
  status: HookJobStatus
  reply: string
  error: string
  conversationId: string
  callbackStatus: number
  callbackAttempts: number
  startedAt: string
  completedAt: string
  failedAt: string
}>

/**
 * Translate a string-timestamp patch (the shape the runner produces) into the
 * Drizzle column update object, mapping ISO strings to Date. Pulled out of
 * updateJob to keep that function's cyclomatic complexity low.
 */
function buildJobUpdate(patch: JobPatch): Partial<typeof hookJobs.$inferInsert> {
  const update: Partial<typeof hookJobs.$inferInsert> = {}
  if (patch.status !== undefined) update.status = patch.status
  if (patch.reply !== undefined) update.reply = patch.reply
  if (patch.error !== undefined) update.error = patch.error
  if (patch.conversationId !== undefined)
    update.conversationId = patch.conversationId
  if (patch.callbackStatus !== undefined)
    update.callbackStatus = patch.callbackStatus
  if (patch.callbackAttempts !== undefined)
    update.callbackAttempts = patch.callbackAttempts
  if (patch.startedAt !== undefined) update.startedAt = new Date(patch.startedAt)
  if (patch.completedAt !== undefined)
    update.completedAt = new Date(patch.completedAt)
  if (patch.failedAt !== undefined) update.failedAt = new Date(patch.failedAt)
  return update
}

async function updateJob(
  tenantId: string,
  agentId: string,
  hookId: string,
  jobId: string,
  patch: JobPatch,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(hookJobs)
    .set(buildJobUpdate(patch))
    .where(
      and(
        eq(hookJobs.id, jobId),
        eq(hookJobs.tenantId, tenantId),
        eq(hookJobs.agentId, agentId),
        eq(hookJobs.hookId, hookId)
      )
    )
}

// ─── Callback delivery ────────────────────────────────────────────────

const MAX_CALLBACK_ATTEMPTS = 3
const CALLBACK_TIMEOUT_MS = 10_000

async function deliverCallback(
  callbackUrl: string,
  payload: object,
  hookSecret: string,
  attempt: number
): Promise<{ ok: boolean; status: number }> {
  const body = JSON.stringify(payload)
  const signature = signPayload(body, hookSecret)

  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hook-Signature': signature,
        'X-Hook-Attempt': String(attempt)
      },
      body,
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS)
    })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

// ─── Async runner (fire-and-forget from the route) ────────────────────

/**
 * Run the agent in the background and deliver the result to callbackUrl.
 * This function is intentionally not awaited by the caller — it runs
 * fully asynchronously after the 202 response has been sent.
 */
export async function runJobAsync(
  job: HookJobDocument,
  hookSecret: string
): Promise<void> {
  const { id: jobId, hookId, agentId, tenantId } = job

  // Guard against SSRF before doing anything with the callbackUrl
  try {
    assertSafeCallbackUrl(job.callbackUrl)
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Invalid callbackUrl'
    await updateJob(tenantId, agentId, hookId, jobId, {
      status: 'failed' as HookJobStatus,
      error,
      failedAt: new Date().toISOString()
    })
    return
  }

  // Mark as running
  await updateJob(tenantId, agentId, hookId, jobId, {
    status: 'running' as HookJobStatus,
    startedAt: new Date().toISOString()
  })

  let reply = ''
  let resolvedConversationId = job.conversationId ?? ''

  try {
    const agent = await getAgentById(agentId)
    if (!agent) throw new Error('Agent not found')

    const userMessage = {
      id: nanoid(),
      role: 'user' as const,
      content: job.message
    }

    const conversation = await ensureConversation({
      tenantId,
      agentId,
      conversationId: job.conversationId,
      userId: null,
      externalId: job.externalUserId ?? hookId,
      initialMessages: [userMessage]
    })

    resolvedConversationId = conversation.id

    const priorMessages = conversation.messages ?? []
    const allMessages = priorMessages.some(m => m.id === userMessage.id)
      ? priorMessages
      : [...priorMessages, userMessage]

    // Check tenant usage limit before running LLM
    const usageCheck = await checkUsageLimit(tenantId)
    if (!usageCheck.allowed) {
      throw new Error(
        `Usage limit reached: ${usageCheck.used}/${usageCheck.limit} messages used`
      )
    }

    const agentStream = await runAgentStream({
      agent,
      messages: allMessages,
      onCompletion: async (completion: string) => {
        const reason = detectCompletionMarker(completion)
        reply = stripCompletionMarkers(completion)
        const nextMessages = [
          ...allMessages,
          { id: nanoid(), role: 'assistant' as const, content: reply }
        ]
        await updateConversationMessages({
          tenantId,
          agentId,
          conversationId: conversation.id,
          messages: nextMessages
        })

        maybeAutoSummarize({
          tenantId,
          agentId,
          conversationId: conversation.id,
          messages: nextMessages,
          currentSummary: conversation.summary,
          summaryResponseCount: conversation.summaryResponseCount,
          responseCounts: conversation.responseCounts
        }).catch(err =>
          console.error('[hook-async] Auto-summarize failed:', err)
        )

        // Record usage for metering (fire-and-forget)
        recordUsage({
          tenantId,
          agentId,
          conversationId: conversation.id,
          userId: null,
          source: 'hook_async',
          model: OPENAI_CHAT_MODEL
        })

        const event = mapCompletionToEvent(reason)
        if (event) {
          dispatchAgentNotification({
            agent,
            conversationId: conversation.id,
            event,
            messageCount: allMessages.filter(m => m.role === 'user').length
          })
        }
      }
    })

    // Drain stream to trigger onCompletion
    const reader = agentStream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // Mark completed
    await updateJob(tenantId, agentId, hookId, jobId, {
      status: 'completed' as HookJobStatus,
      reply,
      conversationId: resolvedConversationId,
      completedAt: new Date().toISOString()
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    await updateJob(tenantId, agentId, hookId, jobId, {
      status: 'failed' as HookJobStatus,
      error,
      failedAt: new Date().toISOString()
    })

    // Deliver failure callback
    await deliverCallback(
      job.callbackUrl,
      {
        jobId,
        hookId,
        agentId,
        status: 'failed',
        error,
        conversationId: resolvedConversationId || null
      },
      hookSecret,
      1
    )
    return
  }

  // ── Deliver success callback with retry ──────────────────────────────
  const callbackPayload = {
    jobId,
    hookId,
    agentId,
    status: 'completed',
    reply,
    conversationId: resolvedConversationId
  }

  let delivered = false
  let lastStatus = 0

  for (let attempt = 1; attempt <= MAX_CALLBACK_ATTEMPTS; attempt++) {
    const result = await deliverCallback(
      job.callbackUrl,
      callbackPayload,
      hookSecret,
      attempt
    )
    lastStatus = result.status

    await updateJob(tenantId, agentId, hookId, jobId, {
      callbackAttempts: attempt,
      callbackStatus: lastStatus
    })

    if (result.ok) {
      delivered = true
      break
    }

    // Exponential back-off: 1s, 2s, 4s
    if (attempt < MAX_CALLBACK_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
    }
  }

  if (!delivered) {
    console.error(
      `[hook-jobs] Callback delivery failed after ${MAX_CALLBACK_ATTEMPTS} attempts`,
      { jobId, callbackUrl: job.callbackUrl, lastStatus }
    )
  }
}
