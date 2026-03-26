import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type InstagramInboxMessageDocument,
  type InboxMessageStatus,
} from '@/lib/firestore-types'
import { getOrCreateConversation } from './conversations'
import { getAccountWithToken } from './accounts'
import type { StoreInboundParams, SendReplyParams } from './types'

const META_GRAPH_API = 'https://graph.facebook.com/v21.0'

/**
 * Store an inbound message from the webhook.
 * Also updates the conversation's lastMessage, unreadCount, and windowExpiresAt.
 */
export async function storeInboundMessage(
  params: StoreInboundParams
): Promise<InstagramInboxMessageDocument> {
  const { tenantId, accountId, message, sender } = params
  const contactIgsid = sender?.id || ''
  const contactName = sender?.name
  const contactUsername = sender?.username

  // Ensure conversation exists
  await getOrCreateConversation(tenantId, accountId, contactIgsid, contactName, contactUsername)

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

  // Store message
  const messagesPath = Collections.instagramInboxMessages(
    tenantId,
    accountId,
    contactIgsid
  )
  const docRef = adminDb.collection(messagesPath).doc()
  const now = new Date().toISOString()

  const msgDoc: InstagramInboxMessageDocument = {
    id: docRef.id,
    igMessageId: message.mid,
    from: contactIgsid,
    to: params.pageId,
    type,
    text,
    mediaUrl,
    direction: 'inbound',
    status: 'received',
    timestamp: now,
    createdAt: now,
  }

  // Update conversation metadata in a batch
  const convoPath = Collections.instagramInboxConversations(tenantId, accountId)
  const convoRef = adminDb.collection(convoPath).doc(contactIgsid)

  const batch = adminDb.batch()
  batch.set(docRef, msgDoc)
  batch.update(convoRef, {
    lastMessageAt: now,
    lastMessagePreview: (text || '').slice(0, 100),
    unreadCount: FieldValue.increment(1),
    ...(contactUsername ? { contactUsername } : {}),
    ...(contactName ? { contactName } : {}),
    // Reset 24h window on each inbound message
    windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: 'open',
    updatedAt: now,
  })

  await batch.commit()

  return msgDoc
}

/**
 * Send a text reply to a conversation.
 * Validates the 24h window and sends via Meta Graph API.
 */
export async function sendReply(
  params: SendReplyParams
): Promise<InstagramInboxMessageDocument> {
  const { tenantId, accountId, contactIgsid, text, userId } = params

  // Check conversation exists and window is open
  const convoPath = Collections.instagramInboxConversations(tenantId, accountId)
  const convoSnap = await adminDb
    .collection(convoPath)
    .doc(contactIgsid)
    .get()

  if (!convoSnap.exists) {
    throw new Error('Conversation not found')
  }

  const convo = convoSnap.data()!
  if (
    convo.windowExpiresAt &&
    new Date(convo.windowExpiresAt) <= new Date()
  ) {
    throw new Error(
      'The 24-hour messaging window has expired. ' +
        'You can only reply within 24 hours of the customer\'s last message.'
    )
  }

  // Get decrypted access token
  const { account, accessToken } = await getAccountWithToken(
    tenantId,
    accountId
  )

  // Send via Meta Graph API (Instagram Messaging)
  const response = await fetch(
    `${META_GRAPH_API}/me/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: contactIgsid },
        message: { text },
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
  const igMessageId = result.message_id || ''

  // Store outbound message
  const messagesPath = Collections.instagramInboxMessages(
    tenantId,
    accountId,
    contactIgsid
  )
  const docRef = adminDb.collection(messagesPath).doc()
  const now = new Date().toISOString()

  const msgDoc: InstagramInboxMessageDocument = {
    id: docRef.id,
    igMessageId,
    from: account.pageId,
    to: contactIgsid,
    type: 'text',
    text,
    direction: 'outbound',
    status: 'sent',
    timestamp: now,
    sentBy: userId,
    createdAt: now,
  }

  // Update conversation
  const convoRef = adminDb.collection(convoPath).doc(contactIgsid)
  const batch = adminDb.batch()
  batch.set(docRef, msgDoc)
  batch.update(convoRef, {
    lastMessageAt: now,
    lastMessagePreview: text.slice(0, 100),
    updatedAt: now,
  })

  await batch.commit()

  return msgDoc
}

/**
 * List messages for a conversation, paginated.
 */
export async function listMessages(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  limit = 50,
  before?: string
): Promise<InstagramInboxMessageDocument[]> {
  const messagesPath = Collections.instagramInboxMessages(
    tenantId,
    accountId,
    contactIgsid
  )

  let query = adminDb
    .collection(messagesPath)
    .orderBy('timestamp', 'asc')

  if (before) {
    query = query.where('timestamp', '<', before)
  }

  const snap = await query.limit(limit).get()
  return snap.docs.map((d: any) => d.data() as InstagramInboxMessageDocument)
}

/**
 * Update message delivery status from webhook.
 * Uses collectionGroup query to find the message across all tenants.
 */
export async function updateMessageStatus(
  igMessageId: string,
  status: InboxMessageStatus,
  timestamp?: string
): Promise<void> {
  const snap = await adminDb
    .collectionGroup('messages')
    .where('igMessageId', '==', igMessageId)
    .where('direction', '==', 'outbound')
    .limit(1)
    .get()

  if (snap.empty) return

  const doc = snap.docs[0]!
  const currentStatus = doc.data().status

  // Only update if the new status is "more advanced" in the lifecycle
  const statusOrder: Record<string, number> = {
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4,
  }

  if (
    statusOrder[status] &&
    statusOrder[currentStatus] &&
    statusOrder[status] <= statusOrder[currentStatus]
  ) {
    return // Don't go backwards
  }

  await doc.ref.update({
    status,
    ...(timestamp ? { [`${status}At`]: timestamp } : {}),
  })
}
