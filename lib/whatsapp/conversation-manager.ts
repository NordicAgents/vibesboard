import { type Message } from 'ai'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { nanoid } from 'nanoid'
import type { VibeAgentConversation } from '@/lib/types'
import { mapConversationRow } from '@/lib/agents/db'

/**
 * Find or create active WhatsApp conversation for connection
 */
export async function ensureWhatsAppConversation(
  tenantId: string,
  agentId: string,
  connectionId: string,
  phoneNumber: string,
  initialMessages: Message[] = []
): Promise<VibeAgentConversation> {
  const collRef = adminDb.collection(
    Collections.conversations(tenantId, agentId)
  )

  // Try to find existing open conversation
  const existingSnap = await collRef
    .where('whatsappConnectionId', '==', connectionId)
    .where('agentId', '==', agentId)
    .where('closedAt', '==', null)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    const doc = existingSnap.docs[0]
    return mapConversationRow({ id: doc.id, ...doc.data() })
  }

  // Create new conversation
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const conversationData = {
    id: docRef.id,
    agentId,
    channel: 'whatsapp',
    whatsappConnectionId: connectionId,
    whatsappPhoneNumber: phoneNumber,
    externalId: phoneNumber,
    messages: serializeMessages(initialMessages),
    whatsappMessageIds: [],
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(conversationData)

  return mapConversationRow(conversationData)
}

/**
 * Add message to WhatsApp conversation
 */
export async function addMessageToConversation(
  tenantId: string,
  agentId: string,
  conversationId: string,
  message: Message,
  whatsappMessageId?: string
): Promise<void> {
  const docRef = adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)

  // Get current conversation
  const snap = await docRef.get()

  if (!snap.exists) {
    throw new Error('Conversation not found')
  }

  const data = snap.data()!
  const currentMessages = (data.messages as any[]) || []
  const currentMessageIds = (data.whatsappMessageIds as string[]) || []

  // Add new message
  const updatedMessages = [
    ...currentMessages,
    {
      id: message.id,
      role: message.role,
      content: message.content,
    },
  ]

  // Add WhatsApp message ID if provided
  const updatedMessageIds = whatsappMessageId
    ? [...currentMessageIds, whatsappMessageId]
    : currentMessageIds

  // Update conversation
  await docRef.update({
    messages: updatedMessages,
    whatsappMessageIds: updatedMessageIds,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Close WhatsApp conversation
 */
export async function closeWhatsAppConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .update({
      closedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Get conversation messages
 */
export async function getConversationMessages(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<Message[]> {
  const snap = await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .get()

  if (!snap.exists) {
    return []
  }

  const data = snap.data()!
  const messages = (data.messages as any[]) || []
  return messages.map(msg => ({
    id: msg.id || nanoid(),
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content as string,
  }))
}

/**
 * Helper to serialize messages for storage
 */
function serializeMessages(messages: Message[]): any[] {
  return messages.map(msg => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
  }))
}
