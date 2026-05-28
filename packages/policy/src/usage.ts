/**
 * Self-host shim — usage logging is a no-op; limits are infinite.
 *
 * The previous implementation wrote usage_logs records to the database and
 * enforced plan limits before agent invocations. Self-host operators who
 * want metering can re-implement this locally; the table
 * `usage_counters` exists in Postgres for ad-hoc rolling totals.
 */

import type { UsageSource } from '@vibesboard/contracts'
import type { PlanId } from '@vibesboard/contracts'

export type { UsageSource }

// ─── Record usage ───────────────────────────────────────────────────

export interface RecordUsageParams {
  tenantId: string
  agentId: string
  conversationId: string | null
  userId: string | null
  externalId?: string | null
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
 * Self-host: no-op.
 */
export function recordUsage(_params: RecordUsageParams): void {}

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
 * Self-host: always allowed with infinite remaining.
 */
export async function checkUsageLimit(
  _tenantId: string,
): Promise<UsageLimitResult> {
  return {
    allowed: true,
    remaining: Number.POSITIVE_INFINITY,
    limit: Number.POSITIVE_INFINITY,
    used: 0,
    planId: 'free',
  }
}

export async function logUsage(_args: unknown): Promise<void> {}

export async function getUsage(
  _args: unknown,
): Promise<{ messages: number; limit: number }> {
  return { messages: 0, limit: Number.POSITIVE_INFINITY }
}

export async function checkLimit(
  _args: unknown,
): Promise<{ allowed: true; remaining: number }> {
  return { allowed: true, remaining: Number.POSITIVE_INFINITY }
}

export async function getUsageRollup(_args: unknown): Promise<{
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
}> {
  return { totalMessages: 0, totalInputTokens: 0, totalOutputTokens: 0 }
}
