import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc } from './db'
import { type VibeAgent } from '@/lib/types'

/**
 * Get agent by ID within a specific tenant
 */
export async function getAgentForUser(
  tenantId: string,
  agentId: string,
  userId: string
): Promise<VibeAgent | null> {
  const doc = await adminDb
    .collection(Collections.agents(tenantId))
    .doc(agentId)
    .get()

  if (!doc.exists) return null
  const data = doc.data()!
  if (data.userId !== userId) return null
  return mapAgentDoc(data)
}

export async function getAgentForMember(
  tenantId: string,
  agentId: string
): Promise<VibeAgent | null> {
  const doc = await adminDb
    .collection(Collections.agents(tenantId))
    .doc(agentId)
    .get()

  if (!doc.exists) return null
  return mapAgentDoc(doc.data()!)
}

/**
 * Get agent by ID, searching across all tenants.
 * Used by public API routes where the caller only has the agent ID.
 */
export async function getAgentById(
  agentId: string
): Promise<VibeAgent | null> {
  // Use collection group query across all tenant agents subcollections
  const snapshot = await adminDb
    .collectionGroup('agents')
    .where('id', '==', agentId)
    .limit(1)
    .get()

  if (snapshot.empty) return null
  return mapAgentDoc(snapshot.docs[0].data())
}

/**
 * Get agent by slug within a specific tenant
 */
export async function getAgentBySlug(
  tenantId: string,
  slug: string
): Promise<VibeAgent | null> {
  const snapshot = await adminDb
    .collection(Collections.agents(tenantId))
    .where('agentUrl', '==', slug)
    .limit(1)
    .get()

  if (snapshot.empty) return null
  return mapAgentDoc(snapshot.docs[0].data())
}
