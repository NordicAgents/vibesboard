import 'server-only'
import { FieldValue } from 'firebase-admin/firestore'
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type UsageSource } from '@/lib/firestore-types'
import { getPlanTemplate, computeMessageLimit, type PlanId } from '@/lib/plans'
import { buildRollupUpdateFields, buildRollupSetFields } from './usage-core'

// ─── Billing cycle helpers ──────────────────────────────────────────

/** Returns YYYY-MM for the current month */
function getCurrentBillingCycleId(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

// ─── Record usage ───────────────────────────────────────────────────

export interface RecordUsageParams {
  tenantId: string
  agentId: string
  conversationId: string | null
  userId: string | null
  externalId?: string | null        // session/hook/external user ID for anonymous tracking
  source: UsageSource
  model: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  retrievalStrategy?: 'direct' | 'rag' | 'bash' | null
  toolCalled?: string | null
}

/**
 * Record a single LLM call for metering.
 * All writes are fire-and-forget — they must not block the chat response.
 */
export function recordUsage(params: RecordUsageParams): void {
  const billingCycleId = getCurrentBillingCycleId()
  const inputTokens = params.inputTokens ?? 0
  const outputTokens = params.outputTokens ?? 0
  const totalTokens = inputTokens + outputTokens

  // 1. Write usage log
  const logRef = adminDb
    .collection(Collections.usageLogs(params.tenantId))
    .doc()
  logRef
    .set({
      id: logRef.id,
      tenantId: params.tenantId,
      agentId: params.agentId,
      conversationId: params.conversationId,
      userId: params.userId,
      source: params.source,
      model: params.model,
      inputTokens,
      outputTokens,
      totalTokens,
      retrievalStrategy: params.retrievalStrategy ?? null,
      toolCalled: params.toolCalled ?? null,
      latencyMs: params.latencyMs ?? 0,
      timestamp: new Date().toISOString(),
      billingCycleId,
    })
    .catch((err: unknown) => console.error('[usage] Failed to write usage log:', err))

  // 2. Atomic increment on tenant message counter (only if subscription exists)
  adminDb
    .collection(Collections.tenants)
    .doc(params.tenantId)
    .get()
    .then((snap: FirebaseFirestore.DocumentSnapshot) => {
      if (snap.data()?.subscription?.planId) {
        return adminDb
          .collection(Collections.tenants)
          .doc(params.tenantId)
          .update({
            'subscription.messageCount': FieldValue.increment(1),
          })
      }
    })
    .catch((err: unknown) =>
      console.error('[usage] Failed to increment message count:', err)
    )

  // 3. Increment rollup (fire-and-forget)
  // Use update() so dot-notation keys are interpreted as nested field paths.
  // Falls back to set() if the document doesn't exist yet (first write this cycle).
  const rollupRef = adminDb
    .collection(Collections.usageRollups(params.tenantId))
    .doc(billingCycleId)
  const incrementFn = (n: number) => FieldValue.increment(n)
  // Use externalId (prefixed) as the user key when userId is null to avoid
  // merging all anonymous usage into a single bucket.
  const effectiveUserId = params.userId ?? (params.externalId ? `ext:${params.externalId}` : null)
  const updateFields = buildRollupUpdateFields({
    source: params.source,
    agentId: params.agentId,
    model: params.model,
    userId: effectiveUserId,
    inputTokens,
    outputTokens,
    incrementFn,
  })

  rollupRef
    .update({
      ...updateFields,
      updatedAt: new Date().toISOString(),
    })
    .catch((err: unknown) => {
      // NOT_FOUND (code 5) — document doesn't exist yet, create it
      if (typeof err === 'object' && err !== null && (err as any).code === 5) {
        const setFields = buildRollupSetFields({
          tenantId: params.tenantId,
          billingCycleId,
          source: params.source,
          agentId: params.agentId,
          model: params.model,
          userId: effectiveUserId,
          inputTokens,
          outputTokens,
          incrementFn,
        })
        rollupRef
          .set(
            { ...setFields, updatedAt: new Date().toISOString() },
            { merge: true }
          )
          .catch((e: unknown) => console.error('[usage] Failed to create rollup:', e))
      } else {
        console.error('[usage] Failed to update rollup:', err)
      }
    })
}

// ─── Check usage limit ──────────────────────────────────────────────

export interface UsageLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  used: number
  planId: PlanId
}

/**
 * Check whether the tenant can make another LLM call.
 * Must be called BEFORE every LLM call.
 *
 * Returns `allowed: true` if:
 * - Tenant has no subscription (legacy/unmetered — defaults to allowed)
 * - Paid plan (overage is billed, never blocked)
 * - Free plan with remaining messages
 */
export async function checkUsageLimit(
  tenantId: string
): Promise<UsageLimitResult> {
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists) {
    // Tenant not found — allow (will fail elsewhere)
    return { allowed: true, remaining: 0, limit: 0, used: 0, planId: 'free' }
  }

  const tenant = tenantDoc.data()

  // Block tenants in pending or suspended state
  if (tenant?.status === 'pending' || tenant?.status === 'suspended') {
    return { allowed: false, remaining: 0, limit: 0, used: 0, planId: 'free' }
  }

  const subscription = tenant?.subscription

  // No subscription yet — tenant hasn't been migrated, allow by default
  if (!subscription) {
    return { allowed: true, remaining: 0, limit: 0, used: 0, planId: 'free' }
  }

  const planId = subscription.planId as PlanId
  const plan = await getPlanTemplate(planId)

  // Live computation: use custom override if set, else compute from live plan template
  const limit = subscription.customMessageLimit != null
    ? subscription.customMessageLimit as number
    : computeMessageLimit(plan, (subscription.seatCount as number) ?? 1)
  const used = (subscription.messageCount as number) ?? 0
  const remaining = Math.max(0, limit - used)

  // Resolve effective overage rate (tenant override > plan default)
  const effectiveOverageRate = subscription.customOverageRate ?? plan.overageRate

  // Hard cap: overageRate === 0 means no overage billing
  if (effectiveOverageRate === 0 && used >= limit) {
    return { allowed: false, remaining: 0, limit, used, planId: plan.id }
  }

  // Paid plans / custom overage: always allowed (overage billed)
  return { allowed: true, remaining, limit, used, planId: plan.id }
}

// ─── Usage limit error response ─────────────────────────────────────

/**
 * Build a 429 JSON response for when usage limit is reached.
 */
export function usageLimitResponse(result: UsageLimitResult) {
  return NextResponse.json(
    {
      error: 'usage_limit_reached',
      message: `You've used all ${result.limit} messages this month. Upgrade to Pro for 5,000 messages/month.`,
      used: result.used,
      limit: result.limit,
      upgradeUrl: '/settings/tenant/billing',
    },
    { status: 429 }
  )
}
