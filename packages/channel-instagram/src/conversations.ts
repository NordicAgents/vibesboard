import { and, eq, desc } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { instagramConversations } from '@vibesboard/adapter-postgres/schema'
import { rowToInstagramConversation } from './db.ts'
import type {
  InstagramInboxConversationDocument,
  InboxConversationStatus,
} from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>
const WINDOW_MS = 24 * 60 * 60 * 1000

async function findRow(
  db: Db,
  tenantId: string,
  accountId: string,
  contactIgsid: string
) {
  const [row] = await db
    .select()
    .from(instagramConversations)
    .where(
      and(
        eq(instagramConversations.tenantId, tenantId),
        eq(instagramConversations.accountId, accountId),
        eq(instagramConversations.contactIgsid, contactIgsid)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Get or create a conversation for a contact IGSID.
 * Idempotent via the (account_id, contact_igsid) unique constraint.
 */
export async function getOrCreateConversation(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  contactName?: string,
  contactUsername?: string,
  db: Db = getMigrateDb()
): Promise<InstagramInboxConversationDocument> {
  const [row] = await db
    .insert(instagramConversations)
    .values({
      id: uuidv7(),
      tenantId,
      accountId,
      contactIgsid,
      contactName: contactName ?? null,
      contactUsername: contactUsername ?? null,
      windowExpiresAt: new Date(Date.now() + WINDOW_MS),
    })
    .onConflictDoUpdate({
      target: [
        instagramConversations.accountId,
        instagramConversations.contactIgsid,
      ],
      set: { updatedAt: new Date() },
    })
    .returning()
  return rowToInstagramConversation(row)
}

/**
 * List conversations for an account, optionally filtered by status.
 */
export async function listConversations(
  tenantId: string,
  accountId: string,
  status?: InboxConversationStatus,
  db: Db = getMigrateDb()
): Promise<InstagramInboxConversationDocument[]> {
  const conds = [
    eq(instagramConversations.tenantId, tenantId),
    eq(instagramConversations.accountId, accountId),
  ]
  if (status) conds.push(eq(instagramConversations.status, status))
  const rows = await db
    .select()
    .from(instagramConversations)
    .where(and(...conds))
    .orderBy(desc(instagramConversations.lastMessageAt))
    .limit(100)
  return rows.map(rowToInstagramConversation)
}

/**
 * Get a single conversation by contact IGSID.
 */
export async function getConversation(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  db: Db = getMigrateDb()
): Promise<InstagramInboxConversationDocument | null> {
  const row = await findRow(db, tenantId, accountId, contactIgsid)
  return row ? rowToInstagramConversation(row) : null
}

/**
 * Update conversation status.
 */
export async function updateConversationStatus(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  status: InboxConversationStatus,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.tenantId, tenantId),
        eq(instagramConversations.accountId, accountId),
        eq(instagramConversations.contactIgsid, contactIgsid)
      )
    )
}

/**
 * Assign a conversation to a team member.
 */
export async function assignConversation(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  userId: string | null,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ assignedTo: userId, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.tenantId, tenantId),
        eq(instagramConversations.accountId, accountId),
        eq(instagramConversations.contactIgsid, contactIgsid)
      )
    )
}

/**
 * Mark conversation as read (reset unread count).
 */
export async function markAsRead(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.tenantId, tenantId),
        eq(instagramConversations.accountId, accountId),
        eq(instagramConversations.contactIgsid, contactIgsid)
      )
    )
}

/**
 * Update per-conversation agent override settings.
 */
export async function updateConversationAgentSettings(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  patch: {
    assignedAgentId?: string | null
    agentPaused?: boolean
    agentHandedOff?: boolean
  },
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(instagramConversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(instagramConversations.tenantId, tenantId),
        eq(instagramConversations.accountId, accountId),
        eq(instagramConversations.contactIgsid, contactIgsid)
      )
    )
}

/**
 * Check if the 24-hour messaging window is still open.
 */
export function isWithinMessageWindow(
  conversation: InstagramInboxConversationDocument
): boolean {
  if (!conversation.windowExpiresAt) return false
  return new Date(conversation.windowExpiresAt) > new Date()
}
