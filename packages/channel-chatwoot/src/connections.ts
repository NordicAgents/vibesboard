import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { customAlphabet } from 'nanoid'
import { sealSecret, unsealSecret } from '@vibesboard/utils/secret-box'
import { and, eq, desc, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb, withDb } from '@vibesboard/adapter-postgres/client'
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
import { chatwootConnections } from '@vibesboard/adapter-postgres/schema'
import { rowToChatwootConnection } from './db.ts'
import {
  type ChatwootConnectionDocument,
  type ChatwootConnectionStatus
} from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

function withChatwootDb<T>(tenantId: string, work: (db: Db) => Promise<T>) {
  return withTenant({ tenantId, userId: null, isSuperAdmin: false }, () =>
    withDb(tx => work(tx as unknown as Db))
  )
}

// ─── ID / Secret generators ─────────────────────────────────────────

const genSecret = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  32
)

// ─── Token encryption ────────────────────────────────────────────────

// Authenticated (AES-256-GCM) encryption with key rotation and transparent
// decryption of legacy CryptoJS ciphertext — see @vibesboard/utils/secret-box.
function encryptToken(token: string): string {
  return sealSecret(token)
}

export function decryptToken(encryptedToken: string): string {
  return unsealSecret(encryptedToken)
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

const CHATWOOT_SIGNING_SECRET_PREFIX = 'chatwoot-signing:v1:'

function sealWebhookSigningSecret(secret: string): string {
  return `${CHATWOOT_SIGNING_SECRET_PREFIX}${sealSecret(secret)}`
}

/**
 * Verify Chatwoot's timestamp-bound signature over `${timestamp}.${rawBody}`.
 * The freshness check limits replay even before the durable delivery-ID guard.
 */
export function verifyChatwootSignature(
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string,
  storedSecret: string,
  options: { nowMs?: number; toleranceSeconds?: number } = {}
): boolean {
  if (!storedSecret.startsWith(CHATWOOT_SIGNING_SECRET_PREFIX)) return false
  const suppliedHex = signatureHeader.replace(/^sha256=/i, '')
  if (!/^[0-9a-f]{64}$/i.test(suppliedHex)) return false
  if (!/^\d{1,12}$/.test(timestampHeader)) return false

  const timestampSeconds = Number(timestampHeader)
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1_000)
  const toleranceSeconds = options.toleranceSeconds ?? 300
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds
  ) {
    return false
  }

  try {
    const secret = unsealSecret(
      storedSecret.slice(CHATWOOT_SIGNING_SECRET_PREFIX.length)
    )
    const expected = createHmac('sha256', secret)
      .update(`${timestampHeader}.${rawBody}`)
      .digest()
    const supplied = Buffer.from(suppliedHex, 'hex')
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    )
  } catch {
    return false
  }
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
  agentBotId?: number | null
  agentBotName?: string | null
  botToken?: string | null
  useAgentBot?: boolean
}

export interface CreatedChatwootConnection {
  connection: ChatwootConnectionDocument
  webhookSecret: string
}

export function generateConnectionId(): string {
  return uuidv7()
}

export function generateWebhookSecret(): string {
  return genSecret()
}

export async function createChatwootConnection(
  tenantId: string,
  agentId: string,
  params: CreateChatwootConnectionParams,
  userId: string,
  connectionId?: string,
  db?: Db
): Promise<CreatedChatwootConnection> {
  if (!db) {
    return withChatwootDb(tenantId, scopedDb =>
      createChatwootConnection(
        tenantId,
        agentId,
        params,
        userId,
        connectionId,
        scopedDb
      )
    )
  }
  const id =
    connectionId && /^[0-9a-f-]{36}$/i.test(connectionId)
      ? connectionId
      : uuidv7()
  const [row] = await db
    .insert(chatwootConnections)
    .values({
      id,
      tenantId,
      agentId,
      userId,
      chatwootUrl: params.chatwootUrl.replace(/\/+$/, ''),
      chatwootAccountId: params.accountId,
      chatwootInboxId: params.inboxId,
      chatwootInboxName: params.inboxName,
      apiTokenEncrypted: encryptToken(params.apiToken),
      chatwootWebhookId: params.chatwootWebhookId ?? null,
      agentBotId: params.agentBotId ?? null,
      agentBotName: params.agentBotName ?? null,
      botTokenEncrypted: params.botToken ? encryptToken(params.botToken) : null,
      useAgentBot: params.useAgentBot ?? false,
      // Column name retained for a migration-free rollout. Legacy rows contain
      // a one-way hash and intentionally fail signed-header verification;
      // reconnecting replaces them with this authenticated encrypted value.
      webhookSecretHash: sealWebhookSigningSecret(params.webhookSecret),
      status: 'active',
      totalConversations: 0
    })
    .returning()

  return {
    connection: rowToChatwootConnection(row),
    webhookSecret: params.webhookSecret
  }
}

/**
 * Look up a connection by its ID across all tenants/agents.
 * Used by the webhook handler which only has the connectionId.
 */
export async function getChatwootConnectionById(
  connectionId: string,
  db?: Db
): Promise<ChatwootConnectionDocument | null> {
  if (!db) {
    const [ref] = await getMigrateDb()
      .select({ tenantId: chatwootConnections.tenantId })
      .from(chatwootConnections)
      .where(eq(chatwootConnections.id, connectionId))
      .limit(1)
    return ref
      ? withChatwootDb(ref.tenantId, scopedDb =>
          getChatwootConnectionById(connectionId, scopedDb)
        )
      : null
  }
  const [row] = await db
    .select()
    .from(chatwootConnections)
    .where(
      and(
        eq(chatwootConnections.id, connectionId),
        eq(chatwootConnections.status, 'active')
      )
    )
    .limit(1)
  return row ? rowToChatwootConnection(row) : null
}

export async function getChatwootConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  db?: Db
): Promise<ChatwootConnectionDocument | null> {
  if (!db) {
    return withChatwootDb(tenantId, scopedDb =>
      getChatwootConnection(tenantId, agentId, connectionId, scopedDb)
    )
  }
  const [row] = await db
    .select()
    .from(chatwootConnections)
    .where(
      and(
        eq(chatwootConnections.tenantId, tenantId),
        eq(chatwootConnections.agentId, agentId),
        eq(chatwootConnections.id, connectionId)
      )
    )
    .limit(1)
  return row ? rowToChatwootConnection(row) : null
}

export async function listChatwootConnections(
  tenantId: string,
  agentId: string,
  status?: ChatwootConnectionStatus,
  db?: Db
): Promise<ChatwootConnectionDocument[]> {
  if (!db) {
    return withChatwootDb(tenantId, scopedDb =>
      listChatwootConnections(tenantId, agentId, status, scopedDb)
    )
  }
  const conds = [
    eq(chatwootConnections.tenantId, tenantId),
    eq(chatwootConnections.agentId, agentId)
  ]
  if (status) conds.push(eq(chatwootConnections.status, status))
  const rows = await db
    .select()
    .from(chatwootConnections)
    .where(and(...conds))
    .orderBy(desc(chatwootConnections.createdAt))
  return rows.map(rowToChatwootConnection)
}

export async function disconnectChatwootConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  reason?: string,
  db?: Db
): Promise<void> {
  if (!db) {
    return withChatwootDb(tenantId, scopedDb =>
      disconnectChatwootConnection(
        tenantId,
        agentId,
        connectionId,
        reason,
        scopedDb
      )
    )
  }
  const now = new Date()
  await db
    .update(chatwootConnections)
    .set({
      status: 'disconnected',
      disconnectedAt: now,
      disconnectionReason: reason ?? null,
      updatedAt: now
    })
    .where(
      and(
        eq(chatwootConnections.tenantId, tenantId),
        eq(chatwootConnections.agentId, agentId),
        eq(chatwootConnections.id, connectionId)
      )
    )
}

export async function deleteChatwootConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  db?: Db
): Promise<void> {
  if (!db) {
    return withChatwootDb(tenantId, scopedDb =>
      deleteChatwootConnection(tenantId, agentId, connectionId, scopedDb)
    )
  }
  await db
    .delete(chatwootConnections)
    .where(
      and(
        eq(chatwootConnections.tenantId, tenantId),
        eq(chatwootConnections.agentId, agentId),
        eq(chatwootConnections.id, connectionId)
      )
    )
}

/**
 * Increment totalConversations and update lastMessageReceivedAt.
 * Fire-and-forget — do not await in the hot path.
 */
export async function updateConnectionStats(
  tenantId: string,
  agentId: string,
  connectionId: string,
  db?: Db
): Promise<void> {
  if (!db) {
    return withChatwootDb(tenantId, scopedDb =>
      updateConnectionStats(tenantId, agentId, connectionId, scopedDb)
    )
  }
  await db
    .update(chatwootConnections)
    .set({
      totalConversations: sql`${chatwootConnections.totalConversations} + 1`,
      lastMessageReceivedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(chatwootConnections.tenantId, tenantId),
        eq(chatwootConnections.agentId, agentId),
        eq(chatwootConnections.id, connectionId)
      )
    )
}
