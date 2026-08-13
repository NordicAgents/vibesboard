import 'server-only'

import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { usageCounters } from '@vibesboard/adapter-postgres/schema'
import type { PlanId, UsageSource } from '@vibesboard/contracts'

export type { UsageSource }

type Db = PostgresJsDatabase<typeof schema>

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

export interface UsageLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  used: number
  planId: PlanId
}

export interface UsageRollup {
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  byAgent: Record<string, number>
  bySource: Record<string, number>
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function monthBounds(now = new Date()) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  )
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  )
  return { start, end }
}

function configuredMonthlyLimit(): number {
  const parsed = Number.parseInt(process.env.MONTHLY_MESSAGE_LIMIT ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : Number.POSITIVE_INFINITY
}

/** Atomically add one completed LLM invocation to the monthly rollup. */
export async function recordUsage(
  params: RecordUsageParams,
  db: Db = getMigrateDb()
): Promise<void> {
  const { start: periodStart } = monthBounds()
  const inputTokens = tokenCount(params.inputTokens)
  const outputTokens = tokenCount(params.outputTokens)

  await db
    .insert(usageCounters)
    .values({
      tenantId: params.tenantId,
      agentId: params.agentId,
      periodStart,
      messageCount: 1,
      inputTokens,
      outputTokens,
      sourceCounts: { [params.source]: 1 }
    })
    .onConflictDoUpdate({
      target: [
        usageCounters.tenantId,
        usageCounters.agentId,
        usageCounters.periodStart
      ],
      set: {
        messageCount: sql`${usageCounters.messageCount} + 1`,
        inputTokens: sql`${usageCounters.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${usageCounters.outputTokens} + ${outputTokens}`,
        sourceCounts: sql`jsonb_set(
          coalesce(${usageCounters.sourceCounts}, '{}'::jsonb),
          ARRAY[${params.source}]::text[],
          to_jsonb(coalesce((${usageCounters.sourceCounts} ->> ${params.source})::integer, 0) + 1),
          true
        )`,
        updatedAt: sql`now()`
      }
    })
}

export async function getUsageRollup(args: {
  tenantId: string
  now?: Date
  db?: Db
}): Promise<UsageRollup> {
  const db = args.db ?? getMigrateDb()
  const { start, end } = monthBounds(args.now)
  const rows = await db
    .select({
      agentId: usageCounters.agentId,
      messageCount: usageCounters.messageCount,
      inputTokens: usageCounters.inputTokens,
      outputTokens: usageCounters.outputTokens,
      sourceCounts: usageCounters.sourceCounts
    })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.tenantId, args.tenantId),
        gte(usageCounters.periodStart, start),
        lt(usageCounters.periodStart, end)
      )
    )

  const rollup: UsageRollup = {
    totalMessages: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byAgent: {},
    bySource: {}
  }
  for (const row of rows) {
    rollup.totalMessages += row.messageCount
    rollup.totalInputTokens += row.inputTokens
    rollup.totalOutputTokens += row.outputTokens
    rollup.byAgent[row.agentId] =
      (rollup.byAgent[row.agentId] ?? 0) + row.messageCount
    for (const [source, count] of Object.entries(row.sourceCounts ?? {})) {
      if (typeof count === 'number' && Number.isFinite(count)) {
        rollup.bySource[source] = (rollup.bySource[source] ?? 0) + count
      }
    }
  }
  return rollup
}

export async function getUsage(args: {
  tenantId: string
  now?: Date
  db?: Db
}): Promise<{ messages: number; limit: number }> {
  const rollup = await getUsageRollup(args)
  return {
    messages: rollup.totalMessages,
    limit: configuredMonthlyLimit()
  }
}

export async function checkUsageLimit(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<UsageLimitResult> {
  const usage = await getUsage({ tenantId, db })
  return {
    allowed: usage.messages < usage.limit,
    remaining: Number.isFinite(usage.limit)
      ? Math.max(0, usage.limit - usage.messages)
      : Number.POSITIVE_INFINITY,
    limit: usage.limit,
    used: usage.messages,
    planId: 'free'
  }
}

/** Backward-compatible aliases used by older callers. */
export async function logUsage(args: RecordUsageParams): Promise<void> {
  await recordUsage(args)
}

export async function checkLimit(args: {
  tenantId: string
  db?: Db
}): Promise<{ allowed: boolean; remaining: number }> {
  const result = await checkUsageLimit(args.tenantId, args.db)
  return { allowed: result.allowed, remaining: result.remaining }
}
