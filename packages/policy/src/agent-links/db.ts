import { and, desc, eq, ne } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agentLinks } from '@vibesboard/adapter-postgres/schema'
import { type AgentLink } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

// Legacy Firestore-style mapper used by API routes that still read raw
// Firestore doc.data() objects (a Record<string,any>). Keep until the routes
// are migrated to Postgres.
export const mapAgentLinkDoc = (data: Record<string, any>): AgentLink => ({
  id: data.id,
  tenantId: data.tenantId,
  slug: data.slug,
  agentId: data.agentId,
  name: data.name,
  description: data.description ?? null,
  isActive: data.isActive ?? true,
  createdBy: data.createdBy ?? '',
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
})

export const mapAgentLinkRow = (row: typeof agentLinks.$inferSelect): AgentLink => ({
  id: row.id,
  tenantId: row.tenantId,
  slug: row.slug,
  agentId: row.agentId,
  name: row.name,
  description: row.description ?? null,
  isActive: row.isActive,
  createdBy: row.createdBy ?? '',
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export async function isLinkSlugAvailable(
  slug: string,
  tenantId: string,
  excludeId?: string,
  db: Db = getMigrateDb()
): Promise<boolean> {
  const conds = [eq(agentLinks.tenantId, tenantId), eq(agentLinks.slug, slug)]
  if (excludeId) conds.push(ne(agentLinks.id, excludeId))
  const rows = await db
    .select({ id: agentLinks.id })
    .from(agentLinks)
    .where(and(...conds))
    .limit(1)
  return rows.length === 0
}

export async function getAgentLinkBySlug(
  tenantId: string,
  slug: string,
  db: Db = getMigrateDb()
): Promise<AgentLink | null> {
  const rows = await db
    .select()
    .from(agentLinks)
    .where(and(eq(agentLinks.tenantId, tenantId), eq(agentLinks.slug, slug)))
    .limit(1)
  return rows.length ? mapAgentLinkRow(rows[0]) : null
}

export async function getAgentLinksForTenant(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<AgentLink[]> {
  const rows = await db
    .select()
    .from(agentLinks)
    .where(eq(agentLinks.tenantId, tenantId))
    .orderBy(desc(agentLinks.createdAt))
  return rows.map(mapAgentLinkRow)
}
