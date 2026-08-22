'use server'
import 'server-only'

import {
  type VibeAgent,
  type VibeAgentConversation
} from '@vibesboard/contracts'
import { getAgentsForTenant } from '@vibesboard/agents/server'
import { listAgentConversations } from '@vibesboard/agents/conversations'
import { getActiveTenant } from '@/lib/tenant-context'

export async function getAgents(userId?: string | null): Promise<VibeAgent[]> {
  if (!userId) return []

  try {
    const activeTenantId = await getActiveTenant(userId)
    if (!activeTenantId) return []
    return await getAgentsForTenant(activeTenantId)
  } catch {
    return []
  }
}

export async function getAgentConversations(
  userId?: string | null
): Promise<VibeAgentConversation[]> {
  if (!userId) return []

  try {
    const activeTenantId = await getActiveTenant(userId)
    if (!activeTenantId) return []

    // Get all agents for the tenant, then their recent visitor conversations
    // (externalId set), newest first, capped per agent.
    const agentsList = await getAgentsForTenant(activeTenantId)

    const perAgent = await Promise.all(
      agentsList.map(async agent => {
        const convs = await listAgentConversations(activeTenantId, agent.id)
        return convs.filter(c => c.externalId != null).slice(0, 10)
      })
    )

    const conversations: VibeAgentConversation[] = []
    const seenIds = new Set<string>()
    for (const convs of perAgent) {
      for (const conv of convs) {
        if (!seenIds.has(conv.id)) {
          seenIds.add(conv.id)
          conversations.push(conv)
        }
      }
    }

    // Sort all conversations by updatedAt descending
    conversations.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return conversations
  } catch {
    return []
  }
}
