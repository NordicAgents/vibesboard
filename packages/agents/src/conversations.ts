import { type Message } from '@vibesboard/contracts'
import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type ConversationRefDocument
} from '@vibesboard/contracts'
import { mapConversationDoc } from './db.ts'
import { type VibeAgentConversation } from '@vibesboard/contracts'

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
    const doc = await adminDb.collection(collPath).doc(conversationId).get()

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
  respondingAgentId?: string
}

export async function updateConversationMessages({
  tenantId,
  agentId,
  conversationId,
  messages,
  summary,
  respondingAgentId
}: UpdateConversationArgs) {
  const collPath = Collections.conversations(tenantId, agentId)

  const updateData: Record<string, any> = {
    messages: serializeMessages(messages),
    updatedAt: new Date().toISOString()
  }

  if (summary !== undefined) {
    updateData.summary = summary
  }

  if (respondingAgentId) {
    updateData[`responseCounts.${respondingAgentId}`] = FieldValue.increment(1)
  }

  await adminDb.collection(collPath).doc(conversationId).update(updateData)
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

/**
 * Check whether a conversation (by externalId) has been handed off to a human.
 */
export async function isConversationHandedOff(
  tenantId: string,
  agentId: string,
  externalId: string
): Promise<boolean> {
  const collPath = Collections.conversations(tenantId, agentId)
  const snapshot = await adminDb
    .collection(collPath)
    .where('externalId', '==', externalId)
    .limit(1)
    .get()

  if (snapshot.empty) return false
  return snapshot.docs[0].data().handedOff === true
}

/**
 * Mark a conversation as handed off to a human agent.
 */
export async function markConversationHandedOff(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  const collPath = Collections.conversations(tenantId, agentId)
  await adminDb
    .collection(collPath)
    .doc(conversationId)
    .update({ handedOff: true, updatedAt: new Date().toISOString() })
}

/**
 * Resume a conversation that was previously handed off to a human agent.
 */
export async function resumeConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  const collPath = Collections.conversations(tenantId, agentId)
  await adminDb
    .collection(collPath)
    .doc(conversationId)
    .update({ handedOff: false, updatedAt: new Date().toISOString() })
}

/**
 * Record an agent-to-agent handoff on a conversation.
 * Appends to the handoffChain array and creates a conversation ref
 * in the target agent's collection for visibility.
 */
export async function recordConversationHandoff(
  tenantId: string,
  agentId: string,
  conversationId: string,
  handoff: {
    fromAgentId: string
    fromAgentName: string
    toAgentId: string
    toAgentName: string
  }
): Promise<void> {
  const collPath = Collections.conversations(tenantId, agentId)
  const ref = adminDb.collection(collPath).doc(conversationId)

  await ref.update({
    handoffChain: FieldValue.arrayUnion({
      ...handoff,
      timestamp: new Date().toISOString()
    }),
    updatedAt: new Date().toISOString()
  })

  // Create a conversation ref in the target agent's collection
  await createConversationRef(tenantId, handoff.toAgentId, {
    id: conversationId,
    sourceAgentId: agentId,
    sourceAgentName: handoff.fromAgentName,
    sourceConversationId: conversationId,
    role: 'active',
    responseCount: 0,
    summary: null,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  })
}

// ── Conversation ref CRUD ────────────────────────────────────────────

export async function createConversationRef(
  tenantId: string,
  targetAgentId: string,
  ref: ConversationRefDocument
): Promise<void> {
  const collPath = Collections.conversationRefs(tenantId, targetAgentId)
  await adminDb.collection(collPath).doc(ref.sourceConversationId).set(ref)
}

export async function updateConversationRef(
  tenantId: string,
  targetAgentId: string,
  conversationId: string,
  updates: Partial<
    Pick<
      ConversationRefDocument,
      'responseCount' | 'lastMessageAt' | 'summary' | 'role'
    >
  >
): Promise<void> {
  const collPath = Collections.conversationRefs(tenantId, targetAgentId)
  await adminDb.collection(collPath).doc(conversationId).update(updates)
}

export async function listConversationRefs(
  tenantId: string,
  agentId: string
): Promise<ConversationRefDocument[]> {
  const collPath = Collections.conversationRefs(tenantId, agentId)
  const snapshot = await adminDb
    .collection(collPath)
    .orderBy('lastMessageAt', 'desc')
    .get()

  return snapshot.docs.map(
    (doc: FirebaseFirestore.QueryDocumentSnapshot) =>
      doc.data() as ConversationRefDocument
  )
}

/**
 * Delete a conversation and its associated data (chunks and refs).
 */
export async function deleteConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<boolean> {
  const BATCH_LIMIT = 500

  // 1. Read the conversation document (single read for existence + handoffChain)
  const convDoc = await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .get()

  if (!convDoc.exists) return false

  // 2. Delete conversation_chunks for this conversation
  const chunksSnap = await adminDb
    .collection(Collections.conversationChunks(tenantId, agentId))
    .where('conversationId', '==', conversationId)
    .get()

  for (let i = 0; i < chunksSnap.docs.length; i += BATCH_LIMIT) {
    const batch = adminDb.batch()
    chunksSnap.docs
      .slice(i, i + BATCH_LIMIT)
      .forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) =>
        batch.delete(doc.ref)
      )
    await batch.commit()
  }

  // 3. Delete conversation_refs in target agents (from handoff chain)
  const data = convDoc.data()!
  const handoffChain = data.handoffChain as
    | Array<{ toAgentId: string }>
    | undefined
  if (handoffChain?.length) {
    for (const entry of handoffChain) {
      try {
        await adminDb
          .collection(Collections.conversationRefs(tenantId, entry.toAgentId))
          .doc(conversationId)
          .delete()
      } catch {
        // Ref may already be deleted
      }
    }
  }

  // 4. Delete the conversation document
  await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .delete()

  return true
}

const serializeMessages = (messages: Message[]) =>
  messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content
  }))
