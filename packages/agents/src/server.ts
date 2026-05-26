import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  agents as agentsTable,
  tenants as tenantsTable,
} from '@vibesboard/adapter-postgres/schema'
import { agentRowToVibeAgent } from './db.ts'
import { type VibeAgent } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

async function fetchAgent(db: Db, where: any): Promise<VibeAgent | null> {
  const rows = await db
    .select({ agent: agentsTable, tenantSlug: tenantsTable.slug })
    .from(agentsTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, agentsTable.tenantId))
    .where(where)
    .limit(1)
  if (rows.length === 0) return null
  return agentRowToVibeAgent(rows[0].agent, rows[0].tenantSlug)
}

export async function getAgentForMember(
  tenantId: string,
  agentId: string,
  db: Db = getMigrateDb(),
): Promise<VibeAgent | null> {
  return fetchAgent(db, and(eq(agentsTable.id, agentId), eq(agentsTable.tenantId, tenantId)))
}

export async function getAgentForUser(
  tenantId: string,
  agentId: string,
  userId: string,
  db: Db = getMigrateDb(),
): Promise<VibeAgent | null> {
  const agent = await getAgentForMember(tenantId, agentId, db)
  if (!agent || agent.userId !== userId) return null
  return agent
}

export async function getAgentById(
  agentId: string,
  db: Db = getMigrateDb(),
): Promise<VibeAgent | null> {
  return fetchAgent(db, eq(agentsTable.id, agentId))
}

export async function getAgentBySlug(
  tenantId: string,
  slug: string,
  db: Db = getMigrateDb(),
): Promise<VibeAgent | null> {
  return fetchAgent(db, and(eq(agentsTable.tenantId, tenantId), eq(agentsTable.slug, slug)))
}

export async function getAgentNamesByTenant(
  tenantId: string,
  agentIds: string[],
  db: Db = getMigrateDb(),
): Promise<Record<string, string>> {
  if (!agentIds.length) return {}
  const rows = await db
    .select({ id: agentsTable.id, name: agentsTable.name })
    .from(agentsTable)
    .where(and(eq(agentsTable.tenantId, tenantId), inArray(agentsTable.id, agentIds)))
  const names: Record<string, string> = {}
  for (const r of rows) names[r.id] = r.name
  return names
}

/** List all agents for a tenant, newest first, in the VibeAgent shape. */
export async function getAgentsForTenant(
  tenantId: string,
  db: Db = getMigrateDb(),
): Promise<VibeAgent[]> {
  const rows = await db
    .select({ agent: agentsTable, tenantSlug: tenantsTable.slug })
    .from(agentsTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, agentsTable.tenantId))
    .where(eq(agentsTable.tenantId, tenantId))
    .orderBy(desc(agentsTable.createdAt))
  return rows.map((r) => agentRowToVibeAgent(r.agent, r.tenantSlug))
}

/**
 * Disable calendar availability and scheduling configs on all agents in a tenant
 * that reference a given calendar connection.
 *
 * Called when a connection is deleted so agents don't silently hold a dead
 * reference — the owner sees the toggle is off and knows to reconnect.
 */
/**
 * Flip a single jsonb config column's `enabled` flag to false for agents in a
 * tenant whose config references the given connection. Uses `jsonb_set` so the
 * rest of the config object is preserved.
 */
async function disableConfigField(
  db: Db,
  tenantId: string,
  connectionId: string,
  column:
    | typeof agentsTable.calendarAvailabilityConfig
    | typeof agentsTable.schedulingConfig,
): Promise<void> {
  await db
    .update(agentsTable)
    .set({
      ...(column === agentsTable.calendarAvailabilityConfig
        ? {
            calendarAvailabilityConfig: sql`jsonb_set(${agentsTable.calendarAvailabilityConfig}, '{enabled}', 'false'::jsonb)`,
          }
        : {
            schedulingConfig: sql`jsonb_set(${agentsTable.schedulingConfig}, '{enabled}', 'false'::jsonb)`,
          }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentsTable.tenantId, tenantId),
        sql`${column} ->> 'calendarConnectionId' = ${connectionId}`,
      ),
    )
}

export async function disableAgentsForConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await disableConfigField(db, tenantId, connectionId, agentsTable.calendarAvailabilityConfig)
  await disableConfigField(db, tenantId, connectionId, agentsTable.schedulingConfig)
}
