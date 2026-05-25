import { and, eq, asc, lt, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  whatsappMessages,
  whatsappConversations,
} from '@vibesboard/adapter-postgres/schema'
import {
  getOrCreateConversation,
  getConversation,
  isWithinMessageWindow,
} from './conversations.ts'
import { getAccountWithToken } from './accounts.ts'
import { rowToWhatsappMessage } from './db.ts'
import type {
  WhatsAppInboxMessageDocument,
  InboxMessageStatus,
} from '@vibesboard/contracts'
import type { StoreInboundParams, SendReplyParams } from './types.ts'

type Db = PostgresJsDatabase<typeof schema>
const META_GRAPH_API = 'https://graph.facebook.com/v21.0'
const WINDOW_MS = 24 * 60 * 60 * 1000
const statusOrder: Record<string, number> = {
  received: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}

interface PersistInboundArgs {
  tenantId: string
  accountId: string
  conversationId: string
  contactPhone: string
  phoneNumberId: string
  waMessageId: string
  type: WhatsAppInboxMessageDocument['type']
  text?: string
  mediaUrl?: string
  caption?: string
  timestampOriginal: Date
  contactName?: string
}

/**
 * Persist an inbound message + bump the conversation metadata (unread, window).
 */
export async function persistInboundMessage(
  a: PersistInboundArgs,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxMessageDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(whatsappMessages)
      .values({
        id: uuidv7(),
        tenantId: a.tenantId,
        conversationId: a.conversationId,
        waMessageId: a.waMessageId,
        fromAddr: a.contactPhone,
        toAddr: a.phoneNumberId,
        type: a.type,
        text: a.text ?? null,
        mediaUrl: a.mediaUrl ?? null,
        caption: a.caption ?? null,
        direction: 'inbound',
        status: 'received',
        timestampOriginal: a.timestampOriginal,
      })
      .returning()
    await tx
      .update(whatsappConversations)
      .set({
        lastMessageAt: a.timestampOriginal,
        lastMessagePreview: (a.text ?? '').slice(0, 100),
        unreadCount: sql`${whatsappConversations.unreadCount} + 1`,
        ...(a.contactName ? { contactProfileName: a.contactName } : {}),
        windowExpiresAt: new Date(Date.now() + WINDOW_MS),
        status: 'open',
        updatedAt: new Date(),
      })
      .where(eq(whatsappConversations.id, a.conversationId))
    return rowToWhatsappMessage(row)
  })
}

interface PersistOutboundArgs {
  tenantId: string
  accountId: string
  conversationId: string
  contactPhone: string
  waMessageId: string
  from: string
  text: string
  timestampOriginal: Date
  sentBy?: string
  sentByAgentName?: string
}

/**
 * Persist an outbound message + update the conversation preview.
 */
export async function persistOutboundMessage(
  a: PersistOutboundArgs,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxMessageDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(whatsappMessages)
      .values({
        id: uuidv7(),
        tenantId: a.tenantId,
        conversationId: a.conversationId,
        waMessageId: a.waMessageId,
        fromAddr: a.from,
        toAddr: a.contactPhone,
        type: 'text',
        text: a.text,
        direction: 'outbound',
        status: 'sent',
        timestampOriginal: a.timestampOriginal,
        sentBy: a.sentBy ?? null,
        sentByAgentName: a.sentByAgentName ?? null,
      })
      .returning()
    await tx
      .update(whatsappConversations)
      .set({
        lastMessageAt: a.timestampOriginal,
        lastMessagePreview: a.text.slice(0, 100),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConversations.id, a.conversationId))
    return rowToWhatsappMessage(row)
  })
}

/**
 * Store an inbound message from the webhook (ensures conversation, persists).
 */
export async function storeInboundMessage(
  params: StoreInboundParams,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxMessageDocument> {
  const { tenantId, accountId, message, contact } = params
  const contactName = contact?.profile?.name

  let text: string | undefined
  let mediaUrl: string | undefined
  let caption: string | undefined

  switch (message.type) {
    case 'text':
      text = message.text?.body
      break
    case 'image':
      mediaUrl = message.image?.id
      caption = message.image?.caption
      text = caption || '[Image]'
      break
    case 'document':
      mediaUrl = message.document?.id
      caption = message.document?.caption || message.document?.filename
      text = caption || '[Document]'
      break
    case 'audio':
      mediaUrl = message.audio?.id
      text = '[Audio]'
      break
    case 'video':
      mediaUrl = message.video?.id
      caption = message.video?.caption
      text = caption || '[Video]'
      break
    case 'location':
      text = message.location?.name || '[Location]'
      break
    case 'contacts':
      text = '[Contact]'
      break
    default:
      text = `[${message.type}]`
  }

  const convo = await getOrCreateConversation(
    tenantId,
    accountId,
    message.from,
    contactName,
    db
  )

  return persistInboundMessage(
    {
      tenantId,
      accountId,
      conversationId: convo.id,
      contactPhone: convo.contactPhone,
      phoneNumberId: params.phoneNumberId,
      waMessageId: message.id,
      type: message.type as WhatsAppInboxMessageDocument['type'],
      text,
      mediaUrl,
      caption,
      timestampOriginal: message.timestamp
        ? new Date(parseInt(message.timestamp) * 1000)
        : new Date(),
      contactName,
    },
    db
  )
}

/**
 * Send a text reply to a conversation (validates 24h window, sends via Meta).
 */
export async function sendReply(
  params: SendReplyParams,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxMessageDocument> {
  const { tenantId, accountId, contactPhone, text, userId, sentByAgentName } =
    params
  const phone = contactPhone.replace(/\D/g, '')

  const convo = await getConversation(tenantId, accountId, phone, db)
  if (!convo) {
    throw new Error('Conversation not found')
  }
  if (!isWithinMessageWindow(convo)) {
    throw new Error(
      'The 24-hour messaging window has expired. ' +
        "You can only reply within 24 hours of the customer's last message."
    )
  }

  const { account, accessToken } = await getAccountWithToken(
    tenantId,
    accountId,
    db
  )

  const response = await fetch(
    `${META_GRAPH_API}/${account.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to send message: ${error.error?.message || 'Unknown error'}`
    )
  }

  const result = await response.json()
  const waMessageId = result.messages?.[0]?.id || ''

  return persistOutboundMessage(
    {
      tenantId,
      accountId,
      conversationId: convo.id,
      contactPhone: phone,
      waMessageId,
      from: account.displayPhoneNumber,
      text,
      timestampOriginal: new Date(),
      sentBy: userId,
      sentByAgentName,
    },
    db
  )
}

/**
 * List messages for a conversation, paginated (chronological asc).
 */
export async function listMessages(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  limit = 50,
  before?: string,
  db: Db = getMigrateDb()
): Promise<WhatsAppInboxMessageDocument[]> {
  const convo = await getConversation(tenantId, accountId, contactPhone, db)
  if (!convo) return []
  const conds = [eq(whatsappMessages.conversationId, convo.id)]
  if (before)
    conds.push(lt(whatsappMessages.timestampOriginal, new Date(before)))
  const rows = await db
    .select()
    .from(whatsappMessages)
    .where(and(...conds))
    .orderBy(asc(whatsappMessages.timestampOriginal))
    .limit(limit)
  return rows.map(rowToWhatsappMessage)
}

/**
 * Update message delivery status from webhook (monotonic, outbound only).
 */
export async function updateMessageStatus(
  waMessageId: string,
  status: InboxMessageStatus,
  _timestamp?: string,
  db: Db = getMigrateDb()
): Promise<void> {
  const [row] = await db
    .select({ id: whatsappMessages.id, status: whatsappMessages.status })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.waMessageId, waMessageId),
        eq(whatsappMessages.direction, 'outbound')
      )
    )
    .limit(1)
  if (!row) return
  if (
    statusOrder[status] !== undefined &&
    statusOrder[row.status] !== undefined &&
    statusOrder[status] <= statusOrder[row.status]
  ) {
    return
  }
  await db
    .update(whatsappMessages)
    .set({ status })
    .where(eq(whatsappMessages.id, row.id))
}
