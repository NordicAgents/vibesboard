import { type Message } from 'ai'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapConversationDoc } from './db'
import { type VibeAgentConversation } from '@/lib/types'

interface ConversationIdentifier {
  conversationId?: string
  userId?: string | null
  externalId?: string | null
}

interface EnsureConversationArgs extends ConversationIdentifier {
  tenantId: string
  agentId: string
  initialMessages?: Message[]
}

export async function ensureConversation({
  tenantId,
  agentId,
  conversationId,
  userId,
  externalId,
  initialMessages = []
}: EnsureConversationArgs): Promise<VibeAgentConversation> {
  const collPath = Collections.conversations(tenantId, agentId)

  if (conversationId) {
    const doc = await adminDb
      .collection(collPath)
      .doc(conversationId)
      .get()

    if (doc.exists) {
      const data = doc.data()!
      if (data.agentId !== agentId) {
        throw new Error('Conversation does not belong to agent')
      }
      if (userId && data.userId && data.userId !== userId) {
        throw new Error('Unauthorized conversation access')
      }
      if (externalId && data.externalId && data.externalId !== externalId) {
        throw new Error('Unauthorized conversation access')
      }
      return mapConversationDoc(data)
    }
  }

  // Look up by externalId if no conversationId was provided
  if (!conversationId && externalId) {
    const snapshot = await adminDb
      .collection(collPath)
      .where('externalId', '==', externalId)
      .limit(1)
      .get()

    if (!snapshot.empty) {
      return mapConversationDoc(snapshot.docs[0].data())
    }
  }

  // Create a new conversation
  const ref = conversationId
    ? adminDb.collection(collPath).doc(conversationId)
    : adminDb.collection(collPath).doc()

  const now = new Date().toISOString()
  const docData = {
    id: ref.id,
    agentId,
    userId: userId ?? null,
    externalId: externalId ?? null,
    messages: serializeMessages(initialMessages),
    summary: null,
    closedAt: null,
    summaryGeneratedAt: null,
    createdAt: now,
    updatedAt: now
  }

  await ref.set(docData)
  return mapConversationDoc(docData)
}

interface UpdateConversationArgs extends ConversationIdentifier {
  tenantId: string
  agentId: string
  conversationId: string
  messages: Message[]
  summary?: string | null
}

export async function updateConversationMessages({
  tenantId,
  agentId,
  conversationId,
  messages,
  summary
}: UpdateConversationArgs) {
  const collPath = Collections.conversations(tenantId, agentId)

  await adminDb
    .collection(collPath)
    .doc(conversationId)
    .update({
      messages: serializeMessages(messages),
      summary: summary ?? null,
      updatedAt: new Date().toISOString()
    })
}

export async function listAgentConversations(
  tenantId: string,
  agentId: string,
  filter?: {
    userId?: string
    externalId?: string
  }
) {
  const collPath = Collections.conversations(tenantId, agentId)
  let query: FirebaseFirestore.Query = adminDb
    .collection(collPath)
    .orderBy('updatedAt', 'desc')

  if (filter?.userId) {
    query = query.where('userId', '==', filter.userId)
  }
  if (filter?.externalId) {
    query = query.where('externalId', '==', filter.externalId)
  }

  const snapshot = await query.get()
  return snapshot.docs.map(doc => mapConversationDoc(doc.data()))
}

export async function getConversation(
  tenantId: string,
  agentId: string,
  id: string
): Promise<VibeAgentConversation | null> {
  const collPath = Collections.conversations(tenantId, agentId)
  const doc = await adminDb.collection(collPath).doc(id).get()

  return doc.exists ? mapConversationDoc(doc.data()!) : null
}

const serializeMessages = (messages: Message[]) =>
  messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content
  }))
