import 'server-only'
import { createHmac } from 'crypto'
import { customAlphabet } from 'nanoid'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type HookJobDocument, type HookJobStatus } from '@/lib/firestore-types'
import { getAgentById } from '@/lib/agents/server'
import { ensureConversation, updateConversationMessages } from '@/lib/agents/conversations'
import { runAgentStream } from '@/lib/agent/runtime'
import { stripCompletionMarkers } from '@/lib/agent/completion'
import { nanoid } from '@/lib/utils'

const genJobId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

// ─── DB helpers ───────────────────────────────────────────────────────

export async function createJob(params: {
  hookId: string
  agentId: string
  tenantId: string
  message: string
  callbackUrl: string
  externalUserId?: string
  conversationId?: string
}): Promise<HookJobDocument> {
  const id = genJobId()
  const now = new Date().toISOString()

  const doc: HookJobDocument = {
    id,
    hookId: params.hookId,
    agentId: params.agentId,
    tenantId: params.tenantId,
    message: params.message,
    callbackUrl: params.callbackUrl,
    externalUserId: params.externalUserId,
    conversationId: params.conversationId,
    status: 'pending',
    callbackAttempts: 0,
    createdAt: now
  }

  await adminDb
    .collection(Collections.hookJobs(params.tenantId, params.agentId, params.hookId))
    .doc(id)
    .set(doc)

  return doc
}

export async function getJob(
  tenantId: string,
  agentId: string,
  hookId: string,
  jobId: string
): Promise<HookJobDocument | null> {
  const snap = await adminDb
    .collection(Collections.hookJobs(tenantId, agentId, hookId))
    .doc(jobId)
    .get()

  return snap.exists ? (snap.data() as HookJobDocument) : null
}

async function updateJob(
  tenantId: string,
  agentId: string,
  hookId: string,
  jobId: string,
  patch: Partial<HookJobDocument>
): Promise<void> {
  await adminDb
    .collection(Collections.hookJobs(tenantId, agentId, hookId))
    .doc(jobId)
    .update(patch)
}

// ─── Callback delivery ────────────────────────────────────────────────

/**
 * Block SSRF: reject callbackUrls that resolve to private/internal addresses.
 * Allows only http/https on public hostnames.
 */
function assertSafeCallbackUrl(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Invalid callbackUrl')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('callbackUrl must use http or https')
  }

  const host = url.hostname.toLowerCase()

  // Block localhost and loopback
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
    throw new Error('callbackUrl must not point to localhost')
  }

  // Block private IPv4 ranges: 10.x, 172.16-31.x, 192.168.x
  const privateIpv4 = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/
  if (privateIpv4.test(host)) {
    throw new Error('callbackUrl must not point to a private IP address')
  }

  // Block link-local and metadata endpoints
  if (host === '169.254.169.254' || host.startsWith('169.254.')) {
    throw new Error('callbackUrl must not point to a link-local address')
  }
}

/**
 * Sign the callback payload with HMAC-SHA256 using the hook's raw secret.
 * The receiving server can verify:
 *   HMAC-SHA256(secret, JSON.stringify(payload)) === X-Hook-Signature header
 */
function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

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

    const userMessage = { id: nanoid(), role: 'user' as const, content: job.message }

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

    const agentStream = await runAgentStream({
      agent,
      messages: allMessages,
      onCompletion: async (completion: string) => {
        reply = stripCompletionMarkers(completion)
        const nextMessages = [
          ...allMessages,
          { id: nanoid(), role: 'assistant' as const, content: reply }
        ]
        await updateConversationMessages({
          tenantId,
          agentId,
          conversationId: conversation.id,
          messages: nextMessages,
          summary: null
        })
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
