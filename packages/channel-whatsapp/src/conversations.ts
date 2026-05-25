import { and, eq, desc } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { whatsappConversations } from '@vibesboard/adapter-postgres/schema'
import { rowToWhatsappConversation } from './db.ts'
import type {
  WhatsAppInboxConversationDocument,
  InboxConversationStatus,
} from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>
const WINDOW_MS = 24 * 60 * 60 * 1000

async function findRow(
  db: Db,
  tenantId: string,
  accountId: string,
  phone: string
) {
  const [row] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.accountId, accountId),
        eq(whatsappConversations.contactPhone, phone)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Get or create a conversation for a contact phone (digits-only normalized).
 * Idempotent via the (account_id, contact_phone) unique constraint.
 */
export async function getOrCreateConversation(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  contactName?: string,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxConversationDocument> {
  const phone = contactPhone.replace(/\D/g, '')
  const [row] = await db
    .insert(whatsappConversations)
    .values({
      id: uuidv7(),
      tenantId,
      accountId,
      contactPhone: phone,
      contactName: contactName ?? null,
      contactProfileName: contactName ?? null,
      windowExpiresAt: new Date(Date.now() + WINDOW_MS),
    })
    .onConflictDoUpdate({
      target: [
        whatsappConversations.accountId,
        whatsappConversations.contactPhone,
      ],
      set: { updatedAt: new Date() },
    })
    .returning()
  return rowToWhatsappConversation(row)
}

/**
 * List conversations for an account, optionally filtered by status.
 */
export async function listConversations(
  tenantId: string,
  accountId: string,
  status?: InboxConversationStatus,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxConversationDocument[]> {
  const conds = [
    eq(whatsappConversations.tenantId, tenantId),
    eq(whatsappConversations.accountId, accountId),
  ]
  if (status) conds.push(eq(whatsappConversations.status, status))
  const rows = await db
    .select()
    .from(whatsappConversations)
    .where(and(...conds))
    .orderBy(desc(whatsappConversations.lastMessageAt))
    .limit(100)
  return rows.map(rowToWhatsappConversation)
}

/**
 * Get a single conversation by contact phone.
 */
export async function getConversation(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxConversationDocument | null> {
  const row = await findRow(
    db,
    tenantId,
    accountId,
    contactPhone.replace(/\D/g, '')
  )
  return row ? rowToWhatsappConversation(row) : null
}

/**
 * Update conversation status.
 */
export async function updateConversationStatus(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  status: InboxConversationStatus,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.accountId, accountId),
        eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))
      )
    )
}

/**
 * Assign a conversation to a team member.
 */
export async function assignConversation(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  userId: string | null,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ assignedTo: userId, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.accountId, accountId),
        eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))
      )
    )
}

/**
 * Mark conversation as read (reset unread count).
 */
export async function markAsRead(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.accountId, accountId),
        eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))
      )
    )
}

/**
 * Update per-conversation agent override settings.
 */
export async function updateConversationAgentSettings(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  patch: {
    assignedAgentId?: string | null
    agentPaused?: boolean
    agentHandedOff?: boolean
  },
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.accountId, accountId),
        eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))
      )
    )
}

/**
 * Set the agent-handoff flag on a conversation by its row id.
 */
export async function setConversationHandoff(
  tenantId: string,
  conversationId: string,
  handedOff: boolean,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ agentHandedOff: handedOff, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.id, conversationId)
      )
    )
}

/**
 * Link a conversation to its core agent conversation id by its row id.
 */
export async function linkAgentConversation(
  tenantId: string,
  conversationId: string,
  agentConversationId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ agentConversationId, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.id, conversationId)
      )
    )
}

/**
 * Check if the 24-hour messaging window is still open.
 */
export function isWithinMessageWindow(
  conversation: WhatsAppInboxConversationDocument
): boolean {
  if (!conversation.windowExpiresAt) return false
  return new Date(conversation.windowExpiresAt) > new Date()
}
