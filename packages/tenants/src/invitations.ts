import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import { isUniqueViolation } from './db-utils.ts'

type Db = PostgresJsDatabase<typeof schema>

export interface AcceptInvitationInput {
  token: string
  userId: string
}

export type AcceptInvitationResult =
  | { ok: true; tenantId: string }
  | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_ACCEPTED' | 'INVALID' | 'ALREADY_MEMBER' }

/**
 * Accept a pending invitation: add the invited user as a tenant member with
 * the invited role and mark the invitation accepted. Identity-adjacent — pass
 * a BYPASSRLS migrate client (no tenant GUC context yet).
 */
export async function acceptInvitation(
  db: Db,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, input.token))
    .limit(1)
  if (rows.length === 0) {
    return { ok: false, code: 'NOT_FOUND' }
  }
  const invite = rows[0]

  if (invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED' }
  }
  if (invite.status === 'accepted') {
    return { ok: false, code: 'ALREADY_ACCEPTED' }
  }
  if (invite.status !== 'pending') {
    return { ok: false, code: 'INVALID' }
  }

  const member = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, invite.tenantId), eq(tenantMembers.userId, input.userId)))
    .limit(1)
  if (member.length > 0) {
    return { ok: false, code: 'ALREADY_MEMBER' }
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(tenantMembers).values({
        tenantId: invite.tenantId,
        userId: input.userId,
        role: invite.role,
      })
      await tx
        .update(invitations)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(invitations.id, invite.id))
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, code: 'ALREADY_MEMBER' }
    }
    throw err
  }

  return { ok: true, tenantId: invite.tenantId }
}
