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

/**
 * Reads an agent's access-password hash for server-side verification.
 *
 * This exists so the hash never has to ride along on the mapped agent object.
 * It used to: `agentRowToVibeAgent` exposed it as `accessPassword`, and the
 * gated pages pass the whole agent into a client component, so an anonymous
 * visitor received the hash in the RSC payload *before* entering any password.
 * Hashes are versioned and randomly salted under a process-wide secret. Legacy
 * unsalted rows are accepted by verification until an owner rotates them.
 *
 * Server-only callers (the verify-access route) fetch it explicitly instead.
 */
export async function getAgentAccessPasswordHash(
  agentId: string,
  db: Db = getMigrateDb(),
): Promise<string | null> {
  const [row] = await db
    .select({ accessPasswordHash: agents.accessPasswordHash })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
  return row?.accessPasswordHash ?? null
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
