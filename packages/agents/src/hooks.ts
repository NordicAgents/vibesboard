import 'server-only'
import { createHash, timingSafeEqual } from 'crypto'
import { customAlphabet } from 'nanoid'
import { and, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { hooks } from '@vibesboard/adapter-postgres/schema'
import type { HookDocument } from '@vibesboard/contracts'
import { rowToHook, rowToHookSafe } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>

// 32-char secret — shown once, never stored in plaintext
const genSecret = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  32
)

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

// ─── Public API ───────────────────────────────────────────────────────

export interface CreatedHook {
  hook: Omit<HookDocument, 'secretHash'>
  /** Raw secret — shown once, never persisted */
  secretKey: string
}

export async function createHook(
  tenantId: string,
  agentId: string,
  name: string,
  db: Db = getMigrateDb()
): Promise<CreatedHook> {
  const secretKey = genSecret()
  const [row] = await db
    .insert(hooks)
    .values({
      id: uuidv7(),
      tenantId,
      agentId,
      name,
      secretHash: hashSecret(secretKey),
      status: 'active',
      requestCount: 0
    })
    .returning()
  return { hook: rowToHookSafe(row), secretKey }
}

export async function getHook(
  tenantId: string,
  agentId: string,
  hookId: string,
  db: Db = getMigrateDb()
): Promise<HookDocument | null> {
  const [row] = await db
    .select()
    .from(hooks)
    .where(
      and(
        eq(hooks.id, hookId),
        eq(hooks.tenantId, tenantId),
        eq(hooks.agentId, agentId)
      )
    )
    .limit(1)
  return row ? rowToHook(row) : null
}

/**
 * Look up a hook by its public ID across all agents (for the public endpoint
 * where we only have the hookId, not tenantId/agentId).
 */
export async function getHookById(
  hookId: string,
  db: Db = getMigrateDb()
): Promise<HookDocument | null> {
  const [row] = await db
    .select()
    .from(hooks)
    .where(eq(hooks.id, hookId))
    .limit(1)
  return row ? rowToHook(row) : null
}

export async function listHooks(
  tenantId: string,
  agentId: string,
  db: Db = getMigrateDb()
): Promise<Omit<HookDocument, 'secretHash'>[]> {
  const rows = await db
    .select()
    .from(hooks)
    .where(and(eq(hooks.tenantId, tenantId), eq(hooks.agentId, agentId)))
    .orderBy(desc(hooks.createdAt))
  return rows.map(rowToHookSafe)
}

export async function updateHook(
  tenantId: string,
  agentId: string,
  hookId: string,
  patch: { name?: string; status?: HookDocument['status'] },
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(hooks)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(hooks.id, hookId),
        eq(hooks.tenantId, tenantId),
        eq(hooks.agentId, agentId)
      )
    )
}

export async function deleteHook(
  tenantId: string,
  agentId: string,
  hookId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .delete(hooks)
    .where(
      and(
        eq(hooks.id, hookId),
        eq(hooks.tenantId, tenantId),
        eq(hooks.agentId, agentId)
      )
    )
}

/**
 * Verify a raw secret against the stored hash using timing-safe comparison
 * to prevent timing attacks.
 */
export function verifySecret(rawSecret: string, storedHash: string): boolean {
  const incoming = Buffer.from(hashSecret(rawSecret), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (incoming.length !== stored.length) return false
  return timingSafeEqual(incoming, stored)
}

/**
 * Increment requestCount and update lastUsedAt. The call site treats this as
 * fire-and-forget (`.catch()`) — it is no longer awaited in the hot path.
 */
export async function recordHookUsage(
  tenantId: string,
  agentId: string,
  hookId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  const now = new Date()
  await db
    .update(hooks)
    .set({
      requestCount: sql`${hooks.requestCount} + 1`,
      lastUsedAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(hooks.id, hookId),
        eq(hooks.tenantId, tenantId),
        eq(hooks.agentId, agentId)
      )
    )
}
