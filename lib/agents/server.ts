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
 * Batch-fetch agent names by IDs within a known tenant.
 * Uses a single Firestore getAll() RPC instead of one query per agent.
 * Prefer this over getAgentNames() whenever the tenant is known (e.g. handoff targets).
 */
export async function getAgentNamesByTenant(
  tenantId: string,
  agentIds: string[]
): Promise<Record<string, string>> {
  if (!agentIds.length) return {}

  const refs = agentIds.map(id =>
    adminDb.collection(Collections.agents(tenantId)).doc(id)
  )
  const snaps = await adminDb.getAll(...refs)

  const names: Record<string, string> = {}
  snaps.forEach((snap, i) => {
    if (snap.exists) {
      names[agentIds[i]] = (snap.data() as Record<string, any>).name
    }
  })
  return names
}


/**
 * Disable calendar availability and scheduling configs on all agents in a tenant
 * that reference a given calendar connection.
 *
 * Called when a connection is deleted so agents don't silently hold a dead
 * reference — the owner sees the toggle is off and knows to reconnect.
 */
export async function disableAgentsForConnection(
  tenantId: string,
  connectionId: string
): Promise<void> {
  const agentsRef = adminDb.collection(Collections.agents(tenantId))

  // Query both config types in parallel — Firestore supports dot-notation on nested fields
  const [availSnap, schedSnap] = await Promise.all([
    agentsRef
      .where('calendarAvailabilityConfig.calendarConnectionId', '==', connectionId)
      .get(),
    agentsRef
      .where('schedulingConfig.calendarConnectionId', '==', connectionId)
      .get()
  ])

  if (availSnap.size + schedSnap.size === 0) return

  const batch = adminDb.batch()

  for (const doc of availSnap.docs) {
    batch.update(doc.ref, { 'calendarAvailabilityConfig.enabled': false })
  }
  for (const doc of schedSnap.docs) {
    batch.update(doc.ref, { 'schedulingConfig.enabled': false })
  }

  await batch.commit()
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
