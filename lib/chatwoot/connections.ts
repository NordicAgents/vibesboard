import 'server-only'

import { createHash, timingSafeEqual } from 'crypto'
import { customAlphabet } from 'nanoid'
import CryptoJS from 'crypto-js'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  Collections,
  type ChatwootConnectionDocument,
  type ChatwootConnectionStatus
} from '@/lib/firestore-types'

// ─── ID / Secret generators ─────────────────────────────────────────

const genId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21
)

const genSecret = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  32
)

// ─── Token encryption (same as whatsapp-bulk) ────────────────────────

function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
  return CryptoJS.AES.encrypt(token, key).toString()
}

export function decryptToken(encryptedToken: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
  const bytes = CryptoJS.AES.decrypt(encryptedToken, key)
  return bytes.toString(CryptoJS.enc.Utf8)
}

// ─── Webhook secret hashing (same as hooks) ─────────────────────────

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function verifyWebhookSecret(
  rawSecret: string,
  storedHash: string
): boolean {
  const incoming = Buffer.from(hashSecret(rawSecret), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (incoming.length !== stored.length) return false
  return timingSafeEqual(incoming, stored)
}

// ─── Public API ──────────────────────────────────────────────────────

export interface CreateChatwootConnectionParams {
  chatwootUrl: string
  apiToken: string
  accountId: number
  inboxId: number
  inboxName: string
  chatwootWebhookId: number | null
  webhookSecret: string
}

export interface CreatedChatwootConnection {
  connection: ChatwootConnectionDocument
  webhookSecret: string
}

export function generateConnectionId(): string {
  return genId()
}

export function generateWebhookSecret(): string {
  return genSecret()
}

export async function createChatwootConnection(
  tenantId: string,
  agentId: string,
  params: CreateChatwootConnectionParams,
  userId: string,
  connectionId?: string
): Promise<CreatedChatwootConnection> {
  const id = connectionId ?? genId()
  const now = new Date().toISOString()

  const doc: ChatwootConnectionDocument = {
    id,
    agentId,
    tenantId,
    userId,
    chatwootUrl: params.chatwootUrl.replace(/\/+$/, ''),
    chatwootAccountId: params.accountId,
    chatwootInboxId: params.inboxId,
    chatwootInboxName: params.inboxName,
    encryptedApiToken: encryptToken(params.apiToken),
    chatwootWebhookId: params.chatwootWebhookId,
    webhookSecretHash: hashSecret(params.webhookSecret),
    status: 'active',
    totalConversations: 0,
    createdAt: now,
    updatedAt: now
  }

  await adminDb
    .collection(Collections.chatwootConnections(tenantId, agentId))
    .doc(id)
    .set(doc)

  return { connection: doc, webhookSecret: params.webhookSecret }
}

/**
 * Look up a connection by its ID across all tenants/agents.
 * Used by the webhook handler which only has the connectionId.
 */
export async function getChatwootConnectionById(
  connectionId: string
): Promise<ChatwootConnectionDocument | null> {
  const snap = await adminDb
    .collectionGroup('chatwoot_connections')
    .where('id', '==', connectionId)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (snap.empty) return null
  return snap.docs[0].data() as ChatwootConnectionDocument
}

export async function getChatwootConnection(
  tenantId: string,
  agentId: string,
  connectionId: string
): Promise<ChatwootConnectionDocument | null> {
  const snap = await adminDb
    .collection(Collections.chatwootConnections(tenantId, agentId))
    .doc(connectionId)
    .get()

  if (!snap.exists) return null
  return snap.data() as ChatwootConnectionDocument
}

export async function listChatwootConnections(
  tenantId: string,
  agentId: string,
  status?: ChatwootConnectionStatus
): Promise<ChatwootConnectionDocument[]> {
  let query: FirebaseFirestore.Query = adminDb
    .collection(Collections.chatwootConnections(tenantId, agentId))
    .orderBy('createdAt', 'desc')

  if (status) {
    query = query.where('status', '==', status)
  }

  const snap = await query.get()
  return snap.docs.map(d => d.data() as ChatwootConnectionDocument)
}

export async function disconnectChatwootConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  reason?: string
): Promise<void> {
  await adminDb
    .collection(Collections.chatwootConnections(tenantId, agentId))
    .doc(connectionId)
    .update({
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      disconnectionReason: reason ?? null,
      updatedAt: new Date().toISOString()
    })
}

export async function deleteChatwootConnection(
  tenantId: string,
  agentId: string,
  connectionId: string
): Promise<void> {
  await adminDb
    .collection(Collections.chatwootConnections(tenantId, agentId))
    .doc(connectionId)
    .delete()
}

/**
 * Increment totalConversations and update lastMessageReceivedAt.
 * Fire-and-forget — do not await in the hot path.
 */
export function updateConnectionStats(
  tenantId: string,
  agentId: string,
  connectionId: string
): void {
  adminDb
    .collection(Collections.chatwootConnections(tenantId, agentId))
    .doc(connectionId)
    .update({
      totalConversations: FieldValue.increment(1),
      lastMessageReceivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    .catch((err: unknown) =>
      console.error('[chatwoot] Failed to update connection stats:', err)
    )
}
