import { and, desc, eq, ne } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agentLinks } from '@vibesboard/adapter-postgres/schema'
import { type AgentLink } from '@vibesboard/contracts'
import { uuidv7 } from 'uuidv7'

type Db = PostgresJsDatabase<typeof schema>

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

export interface CreateAgentLinkInput {
  tenantId: string; agentId: string; slug: string; name: string
  description?: string | null; createdBy: string
}

/** Insert an agent link. Caller must verify the agent exists + slug availability. */
export async function createAgentLink(input: CreateAgentLinkInput, db: Db = getMigrateDb()): Promise<AgentLink> {
  const id = uuidv7()
  const rows = await db.insert(agentLinks).values({
    id, tenantId: input.tenantId, agentId: input.agentId, slug: input.slug,
    name: input.name, description: input.description ?? null, isActive: true, createdBy: input.createdBy,
  }).returning()
  return mapAgentLinkRow(rows[0])
}

export async function getAgentLinkById(tenantId: string, linkId: string, db: Db = getMigrateDb()): Promise<AgentLink | null> {
  const rows = await db.select().from(agentLinks).where(and(eq(agentLinks.tenantId, tenantId), eq(agentLinks.id, linkId))).limit(1)
  return rows.length ? mapAgentLinkRow(rows[0]) : null
}

export interface UpdateAgentLinkInput {
  agentId?: string; name?: string; description?: string | null; isActive?: boolean
}

/** Update an agent link; returns the updated link or null if not found. */
export async function updateAgentLink(tenantId: string, linkId: string, fields: UpdateAgentLinkInput, db: Db = getMigrateDb()): Promise<AgentLink | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (fields.agentId !== undefined) set.agentId = fields.agentId
  if (fields.name !== undefined) set.name = fields.name
  if (fields.description !== undefined) set.description = fields.description
  if (fields.isActive !== undefined) set.isActive = fields.isActive
  const rows = await db.update(agentLinks).set(set).where(and(eq(agentLinks.tenantId, tenantId), eq(agentLinks.id, linkId))).returning()
  return rows.length ? mapAgentLinkRow(rows[0]) : null
}

/** Delete an agent link; returns true if a row was deleted. */
export async function deleteAgentLink(tenantId: string, linkId: string, db: Db = getMigrateDb()): Promise<boolean> {
  const rows = await db.delete(agentLinks).where(and(eq(agentLinks.tenantId, tenantId), eq(agentLinks.id, linkId))).returning({ id: agentLinks.id })
  return rows.length > 0
}
