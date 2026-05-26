import 'server-only'

import { createHash, timingSafeEqual } from 'crypto'
import { customAlphabet } from 'nanoid'
import CryptoJS from 'crypto-js'
import { and, eq, desc, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { chatwootConnections } from '@vibesboard/adapter-postgres/schema'
import { rowToChatwootConnection } from './db.ts'
import {
  type ChatwootConnectionDocument,
  type ChatwootConnectionStatus,
} from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

// ─── ID / Secret generators ─────────────────────────────────────────

const genSecret = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  32
)

// ─── Token encryption ────────────────────────────────────────────────

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
  db: Db = getMigrateDb()
): Promise<CreatedChatwootConnection> {
  const id =
    connectionId && /^[0-9a-f-]{36}$/i.test(connectionId) ? connectionId : uuidv7()
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
      webhookSecretHash: hashSecret(params.webhookSecret),
      status: 'active',
      totalConversations: 0,
    })
    .returning()

  return { connection: rowToChatwootConnection(row), webhookSecret: params.webhookSecret }
}

/**
 * Look up a connection by its ID across all tenants/agents.
 * Used by the webhook handler which only has the connectionId.
 */
export async function getChatwootConnectionById(
  connectionId: string,
  db: Db = getMigrateDb()
): Promise<ChatwootConnectionDocument | null> {
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
  db: Db = getMigrateDb()
): Promise<ChatwootConnectionDocument | null> {
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
  db: Db = getMigrateDb()
): Promise<ChatwootConnectionDocument[]> {
  const conds = [
    eq(chatwootConnections.tenantId, tenantId),
    eq(chatwootConnections.agentId, agentId),
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
  db: Db = getMigrateDb()
): Promise<void> {
  const now = new Date()
  await db
    .update(chatwootConnections)
    .set({
      status: 'disconnected',
      disconnectedAt: now,
      disconnectionReason: reason ?? null,
      updatedAt: now,
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
  db: Db = getMigrateDb()
): Promise<void> {
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
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(chatwootConnections)
    .set({
      totalConversations: sql`${chatwootConnections.totalConversations} + 1`,
      lastMessageReceivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatwootConnections.tenantId, tenantId),
        eq(chatwootConnections.agentId, agentId),
        eq(chatwootConnections.id, connectionId)
      )
    )
}
