import { createHmac, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type InviteCodeDocument } from '@/lib/firestore-types'
import { FieldValue } from 'firebase-admin/firestore'

const SECRET = process.env.ACCESS_GATE_SECRET || 'vibeagent-access-gate-default'

// ─── Password hashing (HMAC-based) ──────────────────────────────────────────

export function hashPassword(plaintext: string): string {
  return createHmac('sha256', SECRET).update(plaintext).digest('hex')
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  return hashPassword(plaintext) === hash
}

// ─── Session cookie (HMAC-signed, session-scoped) ────────────────────────────

function signToken(agentId: string): string {
  const payload = JSON.stringify({ agentId, ts: Date.now() })
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex')
  return Buffer.from(payload).toString('base64') + '.' + sig
}

function verifyToken(token: string, agentId: string): boolean {
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return false
  try {
    const payload = Buffer.from(b64, 'base64').toString()
    const expected = createHmac('sha256', SECRET).update(payload).digest('hex')
    if (sig !== expected) return false
    const data = JSON.parse(payload)
    return data.agentId === agentId
  } catch {
    return false
  }
}

function cookieName(agentId: string) {
  return `va_access_${agentId}`
}

export async function setAccessCookie(agentId: string, opts?: { crossOrigin?: boolean }) {
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
  return snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) => d.data() as InviteCodeDocument)
}

export async function revokeInviteCode(
  tenantId: string,
  agentId: string,
  codeId: string
): Promise<void> {
  await codesCollection(tenantId, agentId).doc(codeId).update({ revoked: true })
}

export type InviteCodeError = 'invalid' | 'revoked' | 'expired' | 'max_uses_reached'

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
  const data = snap.docs[0].data() as InviteCodeDocument

  if (data.revoked) return { ok: false, reason: 'revoked' }
  if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
    return { ok: false, reason: 'expired' }
  }
  if (data.maxUses !== null && data.usedCount >= data.maxUses) {
    return { ok: false, reason: 'max_uses_reached' }
  }

  // Atomic update via transaction
  await adminDb.runTransaction(async (tx: any) => {
    const fresh = await tx.get(docRef)
    const freshData = fresh.data() as InviteCodeDocument
    if (freshData.maxUses !== null && freshData.usedCount >= freshData.maxUses) {
      throw new Error('max_uses_reached')
    }
    tx.update(docRef, {
      usedCount: FieldValue.increment(1),
      redemptions: FieldValue.arrayUnion({
        redeemedAt: new Date().toISOString(),
        externalId
      })
    })
  })

  return { ok: true }
}

// ─── Code generation helper ──────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 for readability
  const bytes = randomBytes(6)
  let result = 'VIBE-'
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}
