import 'server-only'
import { createHash, timingSafeEqual } from 'crypto'
import { customAlphabet } from 'nanoid'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type HookDocument } from '@/lib/firestore-types'

// 21-char URL-safe alphabet — enough entropy for a public token
const genId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

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
  name: string
): Promise<CreatedHook> {
  const id = genId()
  const secretKey = genSecret()
  const now = new Date().toISOString()

  const doc: HookDocument = {
    id,
    agentId,
    tenantId,
    name,
    secretHash: hashSecret(secretKey),
    status: 'active',
    requestCount: 0,
    createdAt: now,
    updatedAt: now
  }

  await adminDb
    .collection(Collections.hooks(tenantId, agentId))
    .doc(id)
    .set(doc)

  const { secretHash: _, ...safeDoc } = doc
  return { hook: safeDoc, secretKey }
}

export async function getHook(
  tenantId: string,
  agentId: string,
  hookId: string
): Promise<HookDocument | null> {
  const snap = await adminDb
    .collection(Collections.hooks(tenantId, agentId))
    .doc(hookId)
    .get()

  if (!snap.exists) return null
  return snap.data() as HookDocument
}

/**
 * Look up a hook by its public ID across all agents (for the public endpoint
 * where we only have the hookId, not tenantId/agentId).
 */
export async function getHookById(hookId: string): Promise<HookDocument | null> {
  const snap = await adminDb
    .collectionGroup('hooks')
    .where('id', '==', hookId)
    .limit(1)
    .get()

  if (snap.empty) return null
  return snap.docs[0].data() as HookDocument
}

export async function listHooks(
  tenantId: string,
  agentId: string
): Promise<Omit<HookDocument, 'secretHash'>[]> {
  const snap = await adminDb
    .collection(Collections.hooks(tenantId, agentId))
    .orderBy('createdAt', 'desc')
    .get()

  return snap.docs.map(d => {
    const { secretHash: _, ...safe } = d.data() as HookDocument
    return safe
  })
}

export async function updateHook(
  tenantId: string,
  agentId: string,
  hookId: string,
  patch: { name?: string; status?: HookDocument['status'] }
): Promise<void> {
  await adminDb
    .collection(Collections.hooks(tenantId, agentId))
    .doc(hookId)
    .update({ ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteHook(
  tenantId: string,
  agentId: string,
  hookId: string
): Promise<void> {
  await adminDb
    .collection(Collections.hooks(tenantId, agentId))
    .doc(hookId)
    .delete()
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
 * Increment requestCount and update lastUsedAt. Fire-and-forget — we do not
 * await this in the hot path.
 */
export function recordHookUsage(
  tenantId: string,
  agentId: string,
  hookId: string
): void {
  const { FieldValue } = require('firebase-admin/firestore')
  adminDb
    .collection(Collections.hooks(tenantId, agentId))
    .doc(hookId)
    .update({
      requestCount: FieldValue.increment(1),
      lastUsedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    .catch((err: unknown) =>
      console.error('[hooks] Failed to record usage:', err)
    )
}
