import { and, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agentInviteCodes } from '@vibesboard/adapter-postgres/schema'
import { generateCode, MAX_STORED_REDEMPTIONS } from '@vibesboard/ai/access-gate-crypto'
import type { InviteCodeDocument } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>
export type InviteCodeError = 'invalid' | 'revoked' | 'expired' | 'max_uses_reached'

function rowToDoc(row: typeof agentInviteCodes.$inferSelect): InviteCodeDocument {
  return {
    id: row.id,
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    revoked: row.revoked,
    redemptions: row.redemptions ?? [],
  }
}

export async function createInviteCode(
  tenantId: string,
  agentId: string,
  opts: { code?: string; expiresAt?: string | null; maxUses?: number | null },
  db: Db = getMigrateDb(),
): Promise<InviteCodeDocument> {
  const code = (opts.code || generateCode()).toUpperCase()
  const rows = await db.insert(agentInviteCodes).values({
    id: uuidv7(),
    tenantId,
    agentId,
    code,
    expiresAt: opts.expiresAt ? new Date(opts.expiresAt) : null,
    maxUses: opts.maxUses ?? null,
    usedCount: 0,
    revoked: false,
    redemptions: [],
  }).returning()
  return rowToDoc(rows[0])
}

export async function listInviteCodes(
  tenantId: string,
  agentId: string,
  db: Db = getMigrateDb(),
): Promise<InviteCodeDocument[]> {
  const rows = await db
    .select()
    .from(agentInviteCodes)
    .where(and(eq(agentInviteCodes.tenantId, tenantId), eq(agentInviteCodes.agentId, agentId)))
    .orderBy(desc(agentInviteCodes.createdAt))
  return rows.map(rowToDoc)
}

export async function revokeInviteCode(
  tenantId: string,
  agentId: string,
  codeId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(agentInviteCodes)
    .set({ revoked: true })
    .where(
      and(
        eq(agentInviteCodes.tenantId, tenantId),
        eq(agentInviteCodes.agentId, agentId),
        eq(agentInviteCodes.id, codeId),
      ),
    )
}

export async function redeemInviteCode(
  tenantId: string,
  agentId: string,
  codeValue: string,
  externalId: string,
  db: Db = getMigrateDb(),
): Promise<{ ok: true } | { ok: false; reason: InviteCodeError }> {
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(agentInviteCodes)
        .where(
          and(
            eq(agentInviteCodes.tenantId, tenantId),
            eq(agentInviteCodes.agentId, agentId),
            eq(agentInviteCodes.code, codeValue.toUpperCase()),
          ),
        )
        .limit(1)
        .for('update')
      if (rows.length === 0) throw new Error('invalid')
      const c = rows[0]
      if (c.revoked) throw new Error('revoked')
      if (c.expiresAt && c.expiresAt.getTime() < Date.now()) throw new Error('expired')
      if (c.maxUses !== null && c.usedCount >= c.maxUses) throw new Error('max_uses_reached')

      const redemptions = c.redemptions ?? []
      const nextRedemptions =
        redemptions.length < MAX_STORED_REDEMPTIONS
          ? [...redemptions, { redeemedAt: new Date().toISOString(), externalId }]
          : redemptions
      await tx
        .update(agentInviteCodes)
        .set({ usedCount: sql`${agentInviteCodes.usedCount} + 1`, redemptions: nextRedemptions })
        .where(eq(agentInviteCodes.id, c.id))
    })
  } catch (err) {
    const reason = (err as Error)?.message as InviteCodeError
    if (['invalid', 'revoked', 'expired', 'max_uses_reached'].includes(reason))
      return { ok: false, reason }
    throw err
  }
  return { ok: true }
}
