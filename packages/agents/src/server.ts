import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb, withDb } from '@vibesboard/adapter-postgres/client'
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
import {
  agents as agentsTable,
  tenants as tenantsTable
} from '@vibesboard/adapter-postgres/schema'
import { agentRowToVibeAgent } from './db.ts'
import { recordAgentVersion } from './versioning.ts'
import { type VibeAgent } from '@vibesboard/contracts'
import { isUuid } from '@vibesboard/utils'

type Db = PostgresJsDatabase<typeof schema>

function withAgentDb<T>(tenantId: string, work: (db: Db) => Promise<T>) {
  return withTenant({ tenantId, userId: null, isSuperAdmin: false }, () =>
    withDb(tx => work(tx as unknown as Db))
  )
}

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
  db?: Db
): Promise<VibeAgent | null> {
  if (!isUuid(tenantId) || !isUuid(agentId)) return null
  if (!db) {
    return withAgentDb(tenantId, scopedDb =>
      getAgentForMember(tenantId, agentId, scopedDb)
    )
  }
  return fetchAgent(
    db,
    and(eq(agentsTable.id, agentId), eq(agentsTable.tenantId, tenantId))
  )
}

export async function getAgentForUser(
  tenantId: string,
  agentId: string,
  userId: string,
  db?: Db
): Promise<VibeAgent | null> {
  if (!isUuid(tenantId) || !isUuid(agentId)) return null
  if (!db) {
    return withAgentDb(tenantId, scopedDb =>
      getAgentForUser(tenantId, agentId, userId, scopedDb)
    )
  }
  const agent = await getAgentForMember(tenantId, agentId, db)
  if (!agent || agent.userId !== userId) return null
  return agent
}

export async function getAgentById(
  agentId: string,
  db?: Db
): Promise<VibeAgent | null> {
  // A non-uuid id can never match a row, so answer "not found" here rather than
  // letting the query throw — this is the shared entry point for the agent
  // pages, the widget, the public/share routes and the hook runners.
  if (!isUuid(agentId)) return null
  if (!db) {
    // The UUID arrives before tenant context on public widget/share routes.
    // Resolve only the tenant key with the admin role, then re-read the full
    // row through the RLS-enforced app role.
    const [ref] = await getMigrateDb()
      .select({ tenantId: agentsTable.tenantId })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
    if (!ref) return null
    return withAgentDb(ref.tenantId, scopedDb =>
      getAgentById(agentId, scopedDb)
    )
  }
  return fetchAgent(db, eq(agentsTable.id, agentId))
}

export async function getAgentBySlug(
  tenantId: string,
  slug: string,
  db?: Db
): Promise<VibeAgent | null> {
  if (!isUuid(tenantId)) return null
  if (!db) {
    return withAgentDb(tenantId, scopedDb =>
      getAgentBySlug(tenantId, slug, scopedDb)
    )
  }
  return fetchAgent(
    db,
    and(eq(agentsTable.tenantId, tenantId), eq(agentsTable.slug, slug))
  )
}

export async function getAgentNamesByTenant(
  tenantId: string,
  agentIds: string[],
  db?: Db
): Promise<Record<string, string>> {
  if (!isUuid(tenantId)) return {}
  if (!db) {
    return withAgentDb(tenantId, scopedDb =>
      getAgentNamesByTenant(tenantId, agentIds, scopedDb)
    )
  }
  const validAgentIds = agentIds.filter(isUuid)
  if (!validAgentIds.length) return {}
  const rows = await db
    .select({ id: agentsTable.id, name: agentsTable.name })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.tenantId, tenantId),
        inArray(agentsTable.id, validAgentIds)
      )
    )
  const names: Record<string, string> = {}
  for (const r of rows) names[r.id] = r.name
  return names
}

/** List all agents for a tenant, newest first, in the VibeAgent shape. */
export async function getAgentsForTenant(
  tenantId: string,
  db?: Db
): Promise<VibeAgent[]> {
  if (!isUuid(tenantId)) return []
  if (!db) {
    return withAgentDb(tenantId, scopedDb =>
      getAgentsForTenant(tenantId, scopedDb)
    )
  }
  const rows = await db
    .select({ agent: agentsTable, tenantSlug: tenantsTable.slug })
    .from(agentsTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, agentsTable.tenantId))
    .where(eq(agentsTable.tenantId, tenantId))
    .orderBy(desc(agentsTable.createdAt))
  return rows.map(r => agentRowToVibeAgent(r.agent, r.tenantSlug))
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
    | typeof agentsTable.schedulingConfig
): Promise<string[]> {
  const rows = await db
    .update(agentsTable)
    .set({
      ...(column === agentsTable.calendarAvailabilityConfig
        ? {
            calendarAvailabilityConfig: sql`jsonb_set(${agentsTable.calendarAvailabilityConfig}, '{enabled}', 'false'::jsonb)`
          }
        : {
            schedulingConfig: sql`jsonb_set(${agentsTable.schedulingConfig}, '{enabled}', 'false'::jsonb)`
          }),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(agentsTable.tenantId, tenantId),
        sql`${column} ->> 'calendarConnectionId' = ${connectionId}`
      )
    )
    .returning({ id: agentsTable.id })
  return rows.map(r => r.id)
}

export async function disableAgentsForConnection(
  tenantId: string,
  connectionId: string,
  db?: Db
): Promise<void> {
  if (!db) {
    return withAgentDb(tenantId, scopedDb =>
      disableAgentsForConnection(tenantId, connectionId, scopedDb)
    )
  }
  const affected = new Set<string>()
  await db.transaction(async tx => {
    const txDb = tx as unknown as Db
    for (const id of await disableConfigField(
      txDb,
      tenantId,
      connectionId,
      agentsTable.calendarAvailabilityConfig
    )) {
      affected.add(id)
    }
    for (const id of await disableConfigField(
      txDb,
      tenantId,
      connectionId,
      agentsTable.schedulingConfig
    )) {
      affected.add(id)
    }
  })

  // Snapshot each agent whose config we auto-disabled, each in its own
  // transaction. The disables above have already committed — a version-write
  // failure for one agent must not roll back the (already-applied) disable
  // for that agent or any other. The no-op guard inside recordAgentVersion
  // skips any agent whose config was already in the disabled state.
  for (const agentId of affected) {
    try {
      await db.transaction(async tx => {
        await recordAgentVersion(tx as unknown as Db, agentId, {
          source: 'system',
          note: 'Calendar connection disabled'
        })
      })
    } catch (error) {
      console.error(
        `[disableAgentsForConnection] Failed to record version for agent ${agentId}:`,
        error
      )
    }
  }
}
