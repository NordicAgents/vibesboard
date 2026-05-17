import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type WhatsAppInboxConversationDocument,
  type InboxConversationStatus
} from '@vibesboard/contracts'

/**
 * Get or create a conversation for a contact phone number.
 * The document ID is the normalized contact phone (digits only).
 */
export async function getOrCreateConversation(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  contactName?: string
): Promise<WhatsAppInboxConversationDocument> {
  const collPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const phoneNormalized = contactPhone.replace(/\D/g, '')
  const docRef = adminDb.collection(collPath).doc(phoneNormalized)

  const snap = await docRef.get()
  if (snap.exists) {
    return snap.data() as WhatsAppInboxConversationDocument
  }

  const now = new Date().toISOString()
  const conversation: WhatsAppInboxConversationDocument = {
    id: phoneNormalized,
    accountId,
    contactName: contactName || undefined,
    contactPhone: phoneNormalized,
    contactProfileName: contactName || undefined,
    lastMessageAt: now,
    lastMessagePreview: '',
    unreadCount: 0,
    status: 'open',
    windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now
  }

  await docRef.set(conversation)
  return conversation
}

/**
 * List conversations for an account, optionally filtered by status.
 */
export async function listConversations(
  tenantId: string,
  accountId: string,
  status?: InboxConversationStatus
): Promise<WhatsAppInboxConversationDocument[]> {
  const collPath = Collections.whatsappInboxConversations(tenantId, accountId)
  let query = adminDb.collection(collPath).orderBy('lastMessageAt', 'desc')

  if (status) {
    query = adminDb
      .collection(collPath)
      .where('status', '==', status)
      .orderBy('lastMessageAt', 'desc')
  }

  const snap = await query.limit(100).get()
  return snap.docs.map(
    (d: any) => d.data() as WhatsAppInboxConversationDocument
  )
}

/**
 * Get a single conversation.
 */
export async function getConversation(
  tenantId: string,
  accountId: string,
  contactPhone: string
): Promise<WhatsAppInboxConversationDocument | null> {
  const collPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const phoneNormalized = contactPhone.replace(/\D/g, '')
  const snap = await adminDb.collection(collPath).doc(phoneNormalized).get()

  return snap.exists ? (snap.data() as WhatsAppInboxConversationDocument) : null
}

/**
 * Update conversation status.
 */
export async function updateConversationStatus(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  status: InboxConversationStatus
): Promise<void> {
  const collPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const phoneNormalized = contactPhone.replace(/\D/g, '')

  await adminDb.collection(collPath).doc(phoneNormalized).update({
    status,
    updatedAt: new Date().toISOString()
  })
}

/**
 * Assign a conversation to a team member.
 */
export async function assignConversation(
  tenantId: string,
  accountId: string,
  contactPhone: string,
  userId: string | null
): Promise<void> {
  const collPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const phoneNormalized = contactPhone.replace(/\D/g, '')

  await adminDb
    .collection(collPath)
    .doc(phoneNormalized)
    .update({
      assignedTo: userId || null,
      updatedAt: new Date().toISOString()
    })
}

/**
 * Mark conversation as read (reset unread count).
 */
export async function markAsRead(
  tenantId: string,
  accountId: string,
  contactPhone: string
): Promise<void> {
  const collPath = Collections.whatsappInboxConversations(tenantId, accountId)
  const phoneNormalized = contactPhone.replace(/\D/g, '')

  await adminDb.collection(collPath).doc(phoneNormalized).update({
    unreadCount: 0,
    updatedAt: new Date().toISOString()
  })
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
