import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/** Stores a (pre-hashed) access password for an agent, scoped by tenant. */
export async function setAgentAccessPasswordHash(
  tenantId: string,
  agentId: string,
  passwordHash: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(agents)
    .set({ accessPasswordHash: passwordHash, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
}

/** Clears an agent's access password, scoped by tenant. */
export async function clearAgentAccessPasswordHash(
  tenantId: string,
  agentId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(agents)
    .set({ accessPasswordHash: null, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
}
