import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/**
 * Atomically increment an agent's lifetime response counter.
 *
 * Fire-and-forget at the call site; replaces the Firestore
 * `FieldValue.increment(1)` update. A single `UPDATE … SET col = col + 1`
 * is atomic under MVCC — no read-modify-write race.
 */
export async function incrementAgentResponseCount(
  tenantId: string,
  agentId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(agents)
    .set({ totalResponseCount: sql`${agents.totalResponseCount} + 1` })
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
}

/**
 * Atomically check the agent's lifetime response cap and, if within the
 * limit, increment the counter to reserve the slot.
 *
 * Returns true  — slot reserved, caller may proceed.
 * Returns false — limit reached, caller should return 403.
 *
 * The conditional `UPDATE … WHERE total_response_count < cap RETURNING id`
 * is atomic under MVCC — concurrent requests cannot both pass the check and
 * both serve a response over the cap, without an explicit transaction.
 *
 * Note: if the request errors after this point the slot is still consumed.
 * That is an acceptable trade-off — better to occasionally lose one slot to a
 * failed request than to serve responses over the limit.
 */
export async function reserveAgentResponseSlot(
  tenantId: string,
  agentId: string,
  maxAgentResponses: number,
  db: Db = getMigrateDb()
): Promise<boolean> {
  const rows = await db
    .update(agents)
    .set({ totalResponseCount: sql`${agents.totalResponseCount} + 1` })
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.tenantId, tenantId),
        sql`${agents.totalResponseCount} < ${maxAgentResponses}`
      )
    )
    .returning({ id: agents.id })
  return rows.length > 0
}
