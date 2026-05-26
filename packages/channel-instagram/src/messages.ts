import { and, eq, asc, lt, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  instagramMessages,
  instagramConversations,
} from '@vibesboard/adapter-postgres/schema'
import {
  getOrCreateConversation,
  getConversation,
  isWithinMessageWindow,
} from './conversations.ts'
import { getAccountWithToken } from './accounts.ts'
import { rowToInstagramMessage } from './db.ts'
import type {
  InstagramInboxMessageDocument,
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
  contactIgsid: string
  pageId: string
  igMessageId: string
  type: InstagramInboxMessageDocument['type']
  text?: string
  mediaUrl?: string
  caption?: string
  timestampOriginal: Date
  contactName?: string
  contactUsername?: string
}

/**
 * Persist an inbound message + bump the conversation metadata (unread, window).
 */
export async function persistInboundMessage(
  a: PersistInboundArgs,
  db: Db = getMigrateDb()
): Promise<InstagramInboxMessageDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(instagramMessages)
      .values({
        id: uuidv7(),
        tenantId: a.tenantId,
        conversationId: a.conversationId,
        igMessageId: a.igMessageId,
        fromAddr: a.contactIgsid,
        toAddr: a.pageId,
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
      .update(instagramConversations)
      .set({
        lastMessageAt: a.timestampOriginal,
        lastMessagePreview: (a.text ?? '').slice(0, 100),
        unreadCount: sql`${instagramConversations.unreadCount} + 1`,
        ...(a.contactName ? { contactName: a.contactName } : {}),
        ...(a.contactUsername ? { contactUsername: a.contactUsername } : {}),
        windowExpiresAt: new Date(Date.now() + WINDOW_MS),
        status: 'open',
        updatedAt: new Date(),
      })
      .where(eq(instagramConversations.id, a.conversationId))
    return rowToInstagramMessage(row)
  })
}

interface PersistOutboundArgs {
  tenantId: string
  accountId: string
  conversationId: string
  contactIgsid: string
  igMessageId: string
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
): Promise<InstagramInboxMessageDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(instagramMessages)
      .values({
        id: uuidv7(),
        tenantId: a.tenantId,
        conversationId: a.conversationId,
        igMessageId: a.igMessageId,
        fromAddr: a.from,
        toAddr: a.contactIgsid,
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
      .update(instagramConversations)
      .set({
        lastMessageAt: a.timestampOriginal,
        lastMessagePreview: a.text.slice(0, 100),
        updatedAt: new Date(),
      })
      .where(eq(instagramConversations.id, a.conversationId))
    return rowToInstagramMessage(row)
  })
}

/**
 * Store an inbound message from the webhook (ensures conversation, persists).
 */
export async function storeInboundMessage(
  params: StoreInboundParams,
  db: Db = getMigrateDb()
): Promise<InstagramInboxMessageDocument> {
  const { tenantId, accountId, message, sender } = params
  const contactIgsid = sender?.id || ''
  const contactName = sender?.name
  const contactUsername = sender?.username

  // Determine text and media from Instagram message
  let text: string | undefined
  let mediaUrl: string | undefined
  let type: InstagramInboxMessageDocument['type'] = 'text'

  if (message.attachments && message.attachments.length > 0) {
    const attachment = message.attachments[0]
    mediaUrl = attachment.payload?.url
    switch (attachment.type) {
      case 'image':
        type = 'image'
        text = message.text || '[Image]'
        break
      case 'video':
        type = 'video'
        text = message.text || '[Video]'
        break
      case 'story_mention':
        type = 'story_mention'
        text = message.text || 'Mentioned you in their story'
        break
      case 'story_reply':
        type = 'story_reply'
        text = message.text || '[Story Reply]'
        break
      case 'share':
        type = 'media_share'
        text = message.text || 'Shared a post'
        break
      default:
        type = 'text'
        text = message.text || `[${attachment.type}]`
    }
  } else if (message.text) {
    text = message.text
    type = 'text'
  } else {
    text = '[Message]'
  }

  const convo = await getOrCreateConversation(
    tenantId,
    accountId,
    contactIgsid,
    contactName,
    contactUsername,
    db
  )

  return persistInboundMessage(
    {
      tenantId,
      accountId,
      conversationId: convo.id,
      contactIgsid,
      pageId: params.pageId,
      igMessageId: message.mid,
      type,
      text,
      mediaUrl,
      timestampOriginal: new Date(),
      contactName,
      contactUsername,
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
): Promise<InstagramInboxMessageDocument> {
  const { tenantId, accountId, contactIgsid, text, userId, sentByAgentName } =
    params

  const convo = await getConversation(tenantId, accountId, contactIgsid, db)
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

  // Send via Meta Graph API (Instagram Messaging)
  const response = await fetch(`${META_GRAPH_API}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: contactIgsid },
      message: { text },
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Failed to send message: ${error.error?.message || 'Unknown error'}`
    )
  }

  const result = await response.json()
  const igMessageId = result.message_id || ''

  return persistOutboundMessage(
    {
      tenantId,
      accountId,
      conversationId: convo.id,
      contactIgsid,
      igMessageId,
      from: account.pageId,
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
  contactIgsid: string,
  limit = 50,
  before?: string,
  db: Db = getMigrateDb()
): Promise<InstagramInboxMessageDocument[]> {
  const convo = await getConversation(tenantId, accountId, contactIgsid, db)
  if (!convo) return []
  const conds = [eq(instagramMessages.conversationId, convo.id)]
  if (before)
    conds.push(lt(instagramMessages.timestampOriginal, new Date(before)))
  const rows = await db
    .select()
    .from(instagramMessages)
    .where(and(...conds))
    .orderBy(asc(instagramMessages.timestampOriginal))
    .limit(limit)
  return rows.map(rowToInstagramMessage)
}

/**
 * Update message delivery status from webhook (monotonic, outbound only).
 */
export async function updateMessageStatus(
  igMessageId: string,
  status: InboxMessageStatus,
  _timestamp?: string,
  db: Db = getMigrateDb()
): Promise<void> {
  const [row] = await db
    .select({ id: instagramMessages.id, status: instagramMessages.status })
    .from(instagramMessages)
    .where(
      and(
        eq(instagramMessages.igMessageId, igMessageId),
        eq(instagramMessages.direction, 'outbound')
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
    .update(instagramMessages)
    .set({ status })
    .where(eq(instagramMessages.id, row.id))
}
