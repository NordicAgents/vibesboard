import { and, eq, desc, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenantMembers, invitations, tenants, users } from '@vibesboard/adapter-postgres/schema'
import { uuidv7 } from 'uuidv7'
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

export interface CreateInvitationInput {
  tenantId: string
  email: string
  role: 'TENANT_ADMIN' | 'MEMBER'
  token: string
  createdBy: string
  expiresAt: Date
}

export interface InvitationRow {
  id: string
  email: string
  role: string
  status: string
  createdAt: string
  expiresAt: string
}

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRow }
  | { ok: false; code: 'ALREADY_MEMBER' | 'PENDING_EXISTS' }

export async function createInvitation(
  db: Db,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const email = input.email.trim().toLowerCase()

  const member = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, input.tenantId), sql`lower(${users.email}) = ${email}`))
    .limit(1)
  if (member.length > 0) return { ok: false, code: 'ALREADY_MEMBER' }

  const pending = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.tenantId, input.tenantId), eq(invitations.email, email), eq(invitations.status, 'pending')))
    .limit(1)
  if (pending.length > 0) return { ok: false, code: 'PENDING_EXISTS' }

  const id = uuidv7()
  const rows = await db
    .insert(invitations)
    .values({
      id,
      tenantId: input.tenantId,
      email,
      token: input.token,
      role: input.role,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    })
    .returning()
  const r = rows[0]
  return {
    ok: true,
    invitation: {
      id: r.id, email: r.email, role: r.role, status: r.status,
      createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    },
  }
}

export async function listInvitations(db: Db, tenantId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tenantId, tenantId))
    .orderBy(desc(invitations.createdAt))
  return rows.map((r) => ({
    id: r.id, email: r.email, role: r.role, status: r.status,
    createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
  }))
}

export interface InvitationPreview {
  id: string
  tenant_id: string
  tenant_name: string | null
  email: string
  role: string
  status: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  invited_by_email: string | null
}

export async function getInvitationByToken(db: Db, token: string): Promise<InvitationPreview | null> {
  const rows = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1)
  if (rows.length === 0) return null
  let inv = rows[0]

  if (inv.expiresAt.getTime() < Date.now() && inv.status === 'pending') {
    const updated = await db
      .update(invitations)
      .set({ status: 'expired' })
      .where(eq(invitations.id, inv.id))
      .returning()
    inv = updated[0]
  }

  const tenantRows = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, inv.tenantId))
    .limit(1)
  const inviterRows = inv.createdBy
    ? await db.select({ email: users.email }).from(users).where(eq(users.id, inv.createdBy)).limit(1)
    : []

  return {
    id: inv.id,
    tenant_id: inv.tenantId,
    tenant_name: tenantRows[0]?.name ?? null,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    created_at: inv.createdAt.toISOString(),
    expires_at: inv.expiresAt.toISOString(),
    accepted_at: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    invited_by_email: inviterRows[0]?.email ?? null,
  }
}

export type CancelInvitationResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ACCEPTED'; tenantId?: string }

export async function getInvitationTenant(
  db: Db,
  id: string,
): Promise<{ tenantId: string; status: string } | null> {
  const rows = await db
    .select({ tenantId: invitations.tenantId, status: invitations.status })
    .from(invitations)
    .where(eq(invitations.id, id))
    .limit(1)
  return rows.length > 0 ? { tenantId: rows[0].tenantId, status: rows[0].status } : null
}

export async function cancelInvitation(db: Db, id: string): Promise<CancelInvitationResult> {
  const existing = await getInvitationTenant(db, id)
  if (!existing) return { ok: false, code: 'NOT_FOUND' }
  if (existing.status === 'accepted') return { ok: false, code: 'ALREADY_ACCEPTED', tenantId: existing.tenantId }
  await db
    .update(invitations)
    .set({ status: 'expired', expiresAt: new Date() })
    .where(eq(invitations.id, id))
  return { ok: true }
}
