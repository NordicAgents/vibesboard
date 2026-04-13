import { cookies } from 'next/headers'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type InviteCodeDocument } from '@/lib/firestore-types'
import { FieldValue } from 'firebase-admin/firestore'

export {
  hashPassword,
  verifyPassword,
  generateCode
} from './access-gate-crypto'
import {
  signToken,
  verifyToken,
  generateCode,
  MAX_STORED_REDEMPTIONS
} from './access-gate-crypto'

export type InviteCodeError =
  | 'invalid'
  | 'revoked'
  | 'expired'
  | 'max_uses_reached'

// ─── Session cookie (HMAC-signed, session-scoped) ────────────────────────────

function cookieName(agentId: string) {
  return `va_access_${agentId}`
}

export async function setAccessCookie(
  agentId: string,
  opts?: { crossOrigin?: boolean }
) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: cookieName(agentId),
    value: signToken(agentId),
    httpOnly: true,
    secure: true,
    sameSite: opts?.crossOrigin ? 'none' : 'lax',
    path: '/'
    // No maxAge = session cookie — dies on browser close
  })
}

export async function hasValidAccessCookie(agentId: string): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(cookieName(agentId))?.value
  if (!token) return false
  return verifyToken(token, agentId)
}

// ─── Invite code CRUD ────────────────────────────────────────────────────────

function codesCollection(tenantId: string, agentId: string) {
  return adminDb.collection(Collections.inviteCodes(tenantId, agentId))
}

export async function createInviteCode(
  tenantId: string,
  agentId: string,
  opts: { code?: string; expiresAt?: string | null; maxUses?: number | null }
): Promise<InviteCodeDocument> {
  const code = (opts.code || generateCode()).toUpperCase()
  const ref = codesCollection(tenantId, agentId).doc()
  const doc: InviteCodeDocument = {
    id: ref.id,
    code,
    createdAt: new Date().toISOString(),
    expiresAt: opts.expiresAt ?? null,
    maxUses: opts.maxUses ?? null,
    usedCount: 0,
    revoked: false,
    redemptions: []
  }
  await ref.set(doc)
  return doc
}

export async function listInviteCodes(
  tenantId: string,
  agentId: string
): Promise<InviteCodeDocument[]> {
  const snap = await codesCollection(tenantId, agentId)
    .orderBy('createdAt', 'desc')
    .get()
  return snap.docs.map(
    (
      d: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
    ) => d.data() as InviteCodeDocument
  )
}

export async function revokeInviteCode(
  tenantId: string,
  agentId: string,
  codeId: string
): Promise<void> {
  await codesCollection(tenantId, agentId).doc(codeId).update({ revoked: true })
}

export async function redeemInviteCode(
  tenantId: string,
  agentId: string,
  codeValue: string,
  externalId: string
): Promise<{ ok: true } | { ok: false; reason: InviteCodeError }> {
  const snap = await codesCollection(tenantId, agentId)
    .where('code', '==', codeValue.toUpperCase())
    .limit(1)
    .get()

  if (snap.empty) return { ok: false, reason: 'invalid' }

  const docRef = snap.docs[0].ref

  // All validation runs inside the transaction against the fresh document
  // to prevent TOCTOU races (e.g. code revoked between read and commit).
  try {
    await adminDb.runTransaction(async (tx: any) => {
      const fresh = await tx.get(docRef)
      const freshData = fresh.data() as InviteCodeDocument

      if (freshData.revoked) throw new Error('revoked')
      if (freshData.expiresAt && new Date(freshData.expiresAt) < new Date()) {
        throw new Error('expired')
      }
      if (
        freshData.maxUses !== null &&
        freshData.usedCount >= freshData.maxUses
      ) {
        throw new Error('max_uses_reached')
      }

      const updateData: Record<string, any> = {
        usedCount: FieldValue.increment(1)
      }
      // Cap inline redemption records to prevent unbounded document growth
      if (freshData.redemptions.length < MAX_STORED_REDEMPTIONS) {
        updateData.redemptions = FieldValue.arrayUnion({
          redeemedAt: new Date().toISOString(),
          externalId
        })
      }
      tx.update(docRef, updateData)
    })
  } catch (err: any) {
    const reason = err?.message as InviteCodeError
    if (
      ['invalid', 'revoked', 'expired', 'max_uses_reached'].includes(reason)
    ) {
      return { ok: false, reason }
    }
    throw err // Re-throw unexpected errors
  }

  return { ok: true }
}
