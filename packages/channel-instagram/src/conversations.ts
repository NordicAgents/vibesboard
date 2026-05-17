import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type InstagramInboxConversationDocument,
  type InboxConversationStatus
} from '@vibesboard/contracts'

/**
 * Get or create a conversation for a contact IGSID.
 * The document ID is the IGSID (already a numeric string).
 */
export async function getOrCreateConversation(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  contactName?: string,
  contactUsername?: string
): Promise<InstagramInboxConversationDocument> {
  const collPath = Collections.instagramInboxConversations(tenantId, accountId)
  const docRef = adminDb.collection(collPath).doc(contactIgsid)

  const snap = await docRef.get()
  if (snap.exists) {
    return snap.data() as InstagramInboxConversationDocument
  }

  const now = new Date().toISOString()
  const conversation: InstagramInboxConversationDocument = {
    id: contactIgsid,
    accountId,
    contactIgsid,
    contactName: contactName || undefined,
    contactUsername: contactUsername || undefined,
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
): Promise<InstagramInboxConversationDocument[]> {
  const collPath = Collections.instagramInboxConversations(tenantId, accountId)
  let query = adminDb.collection(collPath).orderBy('lastMessageAt', 'desc')

  if (status) {
    query = adminDb
      .collection(collPath)
      .where('status', '==', status)
      .orderBy('lastMessageAt', 'desc')
  }

  const snap = await query.limit(100).get()
  return snap.docs.map(
    (d: any) => d.data() as InstagramInboxConversationDocument
  )
}

/**
 * Get a single conversation.
 */
export async function getConversation(
  tenantId: string,
  accountId: string,
  contactIgsid: string
): Promise<InstagramInboxConversationDocument | null> {
  const collPath = Collections.instagramInboxConversations(tenantId, accountId)
  const snap = await adminDb.collection(collPath).doc(contactIgsid).get()

  return snap.exists
    ? (snap.data() as InstagramInboxConversationDocument)
    : null
}

/**
 * Update conversation status.
 */
export async function updateConversationStatus(
  tenantId: string,
  accountId: string,
  contactIgsid: string,
  status: InboxConversationStatus
): Promise<void> {
  const collPath = Collections.instagramInboxConversations(tenantId, accountId)

  await adminDb.collection(collPath).doc(contactIgsid).update({
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
  contactIgsid: string,
  userId: string | null
): Promise<void> {
  const collPath = Collections.instagramInboxConversations(tenantId, accountId)

  await adminDb
    .collection(collPath)
    .doc(contactIgsid)
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
  contactIgsid: string
): Promise<void> {
  const collPath = Collections.instagramInboxConversations(tenantId, accountId)

  await adminDb.collection(collPath).doc(contactIgsid).update({
    unreadCount: 0,
    updatedAt: new Date().toISOString()
  })
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
