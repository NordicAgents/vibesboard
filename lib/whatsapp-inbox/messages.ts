import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type WhatsAppInboxMessageDocument,
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
): Promise<WhatsAppInboxMessageDocument> {
  const { tenantId, accountId, message, contact } = params
  const contactPhone = message.from
  const contactName = contact?.profile?.name

  // Ensure conversation exists
  await getOrCreateConversation(tenantId, accountId, contactPhone, contactName)

  const phoneNormalized = contactPhone.replace(/\D/g, '')

  // Determine text preview
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

  // Store message
  const messagesPath = Collections.whatsappInboxMessages(
    tenantId,
    accountId,
    phoneNormalized
  )
  const docRef = adminDb.collection(messagesPath).doc()
  const now = new Date().toISOString()
  const messageTimestamp = message.timestamp
    ? new Date(parseInt(message.timestamp) * 1000).toISOString()
    : now

  const msgDoc: WhatsAppInboxMessageDocument = {
    id: docRef.id,
    waMessageId: message.id,
    from: contactPhone,
    to: params.phoneNumberId,
    type: message.type as WhatsAppInboxMessageDocument['type'],
    text,
    mediaUrl,
    caption,
    direction: 'inbound',
    status: 'received',
    timestamp: messageTimestamp,
    createdAt: now,
  }

  // Update conversation metadata in a batch
  const convoPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const convoRef = adminDb.collection(convoPath).doc(phoneNormalized)

  const batch = adminDb.batch()
  batch.set(docRef, msgDoc)
  batch.update(convoRef, {
    lastMessageAt: messageTimestamp,
    lastMessagePreview: (text || '').slice(0, 100),
    unreadCount: FieldValue.increment(1),
    contactProfileName: contactName || FieldValue.delete(),
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
): Promise<WhatsAppInboxMessageDocument> {
  const { tenantId, accountId, contactPhone, text, userId, sentByAgentName } = params
  const phoneNormalized = contactPhone.replace(/\D/g, '')

  // Check conversation exists and window is open
  const convoPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const convoSnap = await adminDb
    .collection(convoPath)
    .doc(phoneNormalized)
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

  // Send via Meta Graph API
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
        to: phoneNormalized,
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

  // Store outbound message
  const messagesPath = Collections.whatsappInboxMessages(
    tenantId,
    accountId,
    phoneNormalized
  )
  const docRef = adminDb.collection(messagesPath).doc()
  const now = new Date().toISOString()

  const msgDoc: WhatsAppInboxMessageDocument = {
    id: docRef.id,
    waMessageId,
    from: account.displayPhoneNumber,
    to: phoneNormalized,
    type: 'text',
    text,
    direction: 'outbound',
    status: 'sent',
    timestamp: now,
    sentBy: userId,
    ...(sentByAgentName ? { sentByAgentName } : {}),
    createdAt: now,
  }

  // Update conversation
  const convoRef = adminDb.collection(convoPath).doc(phoneNormalized)
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
  contactPhone: string,
  limit = 50,
  before?: string
): Promise<WhatsAppInboxMessageDocument[]> {
  const phoneNormalized = contactPhone.replace(/\D/g, '')
  const messagesPath = Collections.whatsappInboxMessages(
    tenantId,
    accountId,
    phoneNormalized
  )

  let query = adminDb
    .collection(messagesPath)
    .orderBy('timestamp', 'asc')

  if (before) {
    query = query.where('timestamp', '<', before)
  }

  const snap = await query.limit(limit).get()
  return snap.docs.map((d: any) => d.data() as WhatsAppInboxMessageDocument)
}

/**
 * Update message delivery status from webhook.
 * Uses collectionGroup query to find the message across all tenants.
 */
export async function updateMessageStatus(
  waMessageId: string,
  status: InboxMessageStatus,
  timestamp?: string
): Promise<void> {
  const snap = await adminDb
    .collectionGroup('messages')
    .where('waMessageId', '==', waMessageId)
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
