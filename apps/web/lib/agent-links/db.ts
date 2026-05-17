import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { AgentLink } from '@/lib/types'

/**
 * Map a Firestore agent link document to the AgentLink interface
 */
export const mapAgentLinkDoc = (data: Record<string, any>): AgentLink => ({
  id: data.id,
  tenantId: data.tenantId,
  slug: data.slug,
  agentId: data.agentId,
  name: data.name,
  description: data.description ?? null,
  isActive: data.isActive ?? true,
  createdBy: data.createdBy,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt
})

/**
 * Check if a link slug is available within a tenant
 */
export async function isLinkSlugAvailable(
  slug: string,
  tenantId: string,
  excludeId?: string
): Promise<boolean> {
  const snapshot = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .where('slug', '==', slug)
    .limit(1)
    .get()

  if (snapshot.empty) return true

  // If we're excluding a specific link (for updates), check if the match is that link
  if (excludeId && snapshot.docs[0].id === excludeId) return true

  return false
}

/**
 * Get an agent link by slug within a tenant (for public resolution)
 */
export async function getAgentLinkBySlug(
  tenantId: string,
  slug: string
): Promise<AgentLink | null> {
  const snapshot = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .where('slug', '==', slug)
    .limit(1)
    .get()

  if (snapshot.empty) return null

  return mapAgentLinkDoc(snapshot.docs[0].data())
}

/**
 * Get all agent links for a tenant
 */
export async function getAgentLinksForTenant(
  tenantId: string
): Promise<AgentLink[]> {
  const snapshot = await adminDb
    .collection(Collections.agentLinks(tenantId))
    .orderBy('createdAt', 'desc')
    .get()

  return snapshot.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) =>
    mapAgentLinkDoc(doc.data())
  )
}
