import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  Collections,
  type WhatsAppAgentConnectionDocument,
  type AgentDocument,
} from '@/lib/firestore-types'
import type {
  WhatsAppAgentConnection,
  WhatsAppConnectionWithAgent,
  CreateConnectionParams,
  UpdateConnectionParams,
} from './types'

/**
 * Normalize phone number to digits only for searching
 */
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Validate phone number format (E.164)
 */
export function validatePhoneNumber(phone: string): boolean {
  // E.164 format: +[country code][number]
  // Length: 8-15 digits after +
  const e164Regex = /^\+[1-9]\d{7,14}$/
  return e164Regex.test(phone)
}

/**
 * Find active connection by phone number
 * Searches across all agents in a tenant
 */
export async function findActiveConnection(
  tenantId: string,
  phoneNumber: string
): Promise<WhatsAppConnectionWithAgent | null> {
  const normalized = normalizePhoneNumber(phoneNumber)

  // Use collectionGroup to search across all agents' whatsapp_connections
  const snap = await adminDb
    .collectionGroup('whatsapp_connections')
    .where('phoneNumberNormalized', '==', normalized)
    .where('status', '==', 'active')
    .limit(1)
    .get()

  if (snap.empty) {
    return null
  }

  const connectionDoc = snap.docs[0]
  const connection = connectionDoc.data() as WhatsAppAgentConnectionDocument

  // Extract tenantId and agentId from path:
  // tenants/{tenantId}/agents/{agentId}/whatsapp_connections/{docId}
  const pathParts = connectionDoc.ref.path.split('/')
  const docTenantId = pathParts[1]
  const agentId = pathParts[3]

  // Verify this belongs to the right tenant
  if (docTenantId !== tenantId) {
    return null
  }

  // Fetch the agent document
  const agentSnap = await adminDb
    .collection(Collections.agents(tenantId))
    .doc(agentId)
    .get()

  if (!agentSnap.exists) {
    return null
  }

  const agentData = agentSnap.data() as AgentDocument

  return {
    ...connection,
    agent: {
      id: agentData.id,
      userId: agentData.userId,
      name: agentData.name,
      mode: agentData.mode,
      greetingText: agentData.greetingText,
      instructions: agentData.instructions,
      fileKeys: agentData.fileKeys,
      agentUrl: agentData.agentUrl,
      allowAnonymous: agentData.allowAnonymous,
      quickSuggestionsMode: agentData.quickSuggestionsMode,
      quickSuggestionsCount: agentData.quickSuggestionsCount,
      maxMessages: agentData.maxMessages,
      lastEmbeddingsSyncAt: agentData.lastEmbeddingsSyncAt,
      createdAt: agentData.createdAt,
      updatedAt: agentData.updatedAt,
    },
  }
}

/**
 * Find connection by ID
 */
export async function findConnectionById(
  tenantId: string,
  agentId: string,
  connectionId: string
): Promise<WhatsAppAgentConnection | null> {
  const snap = await adminDb
    .collection(Collections.whatsappConnections(tenantId, agentId))
    .doc(connectionId)
    .get()

  if (!snap.exists) {
    return null
  }

  return snap.data() as WhatsAppAgentConnection
}

/**
 * Create new phone number connection
 */
export async function createConnection(
  tenantId: string,
  agentId: string,
  params: CreateConnectionParams,
  userId: string
): Promise<WhatsAppAgentConnection> {
  // Validate phone number
  if (!validatePhoneNumber(params.phoneNumber)) {
    throw new Error(
      'Invalid phone number format. Use E.164 format (e.g., +919400293288)'
    )
  }

  const normalized = normalizePhoneNumber(params.phoneNumber)
  const collRef = adminDb.collection(
    Collections.whatsappConnections(tenantId, agentId)
  )

  // Check if phone already connected to this agent
  const existingSnap = await collRef
    .where('phoneNumberNormalized', '==', normalized)
    .where('status', 'in', ['active', 'pending'])
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    throw new Error('This phone number is already connected to this agent')
  }

  // Create connection
  const now = new Date().toISOString()
  const docRef = collRef.doc()
  const connection: WhatsAppAgentConnectionDocument = {
    id: docRef.id,
    agentId,
    userId,
    phoneNumber: params.phoneNumber,
    phoneNumberNormalized: normalized,
    status: 'pending',
    customIntroMessage: params.customIntroMessage,
    totalConversations: 0,
    expiresAt: params.expiresAt?.toISOString(),
    createdAt: now,
    updatedAt: now,
  }

  await docRef.set(connection)

  return connection
}

/**
 * Update connection
 */
export async function updateConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  params: UpdateConnectionParams
): Promise<WhatsAppAgentConnection | null> {
  const docRef = adminDb
    .collection(Collections.whatsappConnections(tenantId, agentId))
    .doc(connectionId)

  const updateData: Record<string, any> = {
    ...params,
    updatedAt: new Date().toISOString(),
  }

  // Remove undefined values
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === undefined) {
      delete updateData[key]
    }
  })

  await docRef.update(updateData)

  const updatedSnap = await docRef.get()
  if (!updatedSnap.exists) {
    return null
  }

  return updatedSnap.data() as WhatsAppAgentConnection
}

/**
 * Mark connection as active after intro sent
 */
export async function activateConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  introMessageId: string
): Promise<WhatsAppAgentConnection | null> {
  return updateConnection(tenantId, agentId, connectionId, {
    status: 'active',
    introMessageSentAt: new Date().toISOString(),
    introMessageId,
    connectedAt: new Date().toISOString(),
  })
}

/**
 * Disconnect phone number from agent
 */
export async function disconnectConnection(
  tenantId: string,
  agentId: string,
  connectionId: string,
  reason?: string
): Promise<WhatsAppAgentConnection | null> {
  return updateConnection(tenantId, agentId, connectionId, {
    status: 'disconnected',
    disconnectedAt: new Date().toISOString(),
    disconnectionReason: reason || 'Manual disconnect',
  })
}

/**
 * Increment conversation counter
 */
export async function incrementConversationCount(
  tenantId: string,
  agentId: string,
  connectionId: string
): Promise<void> {
  await adminDb
    .collection(Collections.whatsappConnections(tenantId, agentId))
    .doc(connectionId)
    .update({
      totalConversations: FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    })
}

/**
 * List connections for an agent
 */
export async function listAgentConnections(
  tenantId: string,
  agentId: string,
  status?: string
): Promise<WhatsAppAgentConnection[]> {
  let query: FirebaseFirestore.Query = adminDb
    .collection(Collections.whatsappConnections(tenantId, agentId))
    .orderBy('createdAt', 'desc')

  if (status) {
    query = query.where('status', '==', status)
  }

  const snap = await query.get()
  return snap.docs.map(doc => doc.data() as WhatsAppAgentConnection)
}

/**
 * Reset connection (close all conversations, reset stats)
 */
export async function resetConnection(
  tenantId: string,
  agentId: string,
  connectionId: string
): Promise<void> {
  // Close all active conversations for this connection
  const conversationsSnap = await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .where('whatsappConnectionId', '==', connectionId)
    .where('closedAt', '==', null)
    .get()

  if (!conversationsSnap.empty) {
    const batch = adminDb.batch()
    for (const doc of conversationsSnap.docs) {
      batch.update(doc.ref, {
        closedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
    await batch.commit()
  }

  // Reset connection stats
  await adminDb
    .collection(Collections.whatsappConnections(tenantId, agentId))
    .doc(connectionId)
    .update({
      totalConversations: 0,
      lastMessageReceivedAt: FieldValue.delete(),
      updatedAt: new Date().toISOString(),
    })
}

/**
 * Expire old connections (run via cron)
 */
export async function expireOldConnections(
  tenantId: string
): Promise<number> {
  // Use collectionGroup to find expiring connections across all agents
  const now = new Date().toISOString()
  const snap = await adminDb
    .collectionGroup('whatsapp_connections')
    .where('status', '==', 'active')
    .where('expiresAt', '<', now)
    .get()

  if (snap.empty) {
    return 0
  }

  // Filter to only this tenant's connections
  const tenantDocs = snap.docs.filter(doc => {
    const pathParts = doc.ref.path.split('/')
    return pathParts[1] === tenantId
  })

  if (tenantDocs.length === 0) {
    return 0
  }

  const batch = adminDb.batch()
  for (const doc of tenantDocs) {
    batch.update(doc.ref, {
      status: 'expired',
      updatedAt: new Date().toISOString(),
    })
  }
  await batch.commit()

  return tenantDocs.length
}
