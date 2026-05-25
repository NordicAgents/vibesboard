import 'server-only'

import { getAgentForMember } from '@vibesboard/agents/server'
import type { VibeAgent } from '@vibesboard/contracts'
import * as wa from '@vibesboard/channel-whatsapp/conversations'
import * as waAcc from '@vibesboard/channel-whatsapp/accounts'
import * as ig from '@vibesboard/channel-instagram/conversations'
import * as igAcc from '@vibesboard/channel-instagram/accounts'

export type InboxChannel = 'whatsapp' | 'instagram'

/**
 * Resolve the effective agent for an inbox conversation.
 *
 * Resolution order:
 * 1. Per-conversation assignedAgentId (override)
 * 2. Account-level assignedAgentId (default)
 * 3. Check conversation flags: agentPaused, agentHandedOff → skip if set
 * 4. Check account agentAutoReply → skip if false
 * 5. Load and return the agent
 *
 * Both WhatsApp and Instagram data layers are on Postgres (Phase 5a/5b).
 */
export async function resolveInboxAgent(
  tenantId: string,
  accountId: string,
  contactId: string,
  channel: InboxChannel
): Promise<{ agentId: string; agent: VibeAgent } | null> {
  if (channel === 'whatsapp') {
    const convo = await wa.getConversation(tenantId, accountId, contactId)
    if (convo?.agentPaused || convo?.agentHandedOff) return null

    let agentId = convo?.assignedAgentId ?? undefined
    if (!agentId) {
      const account = await waAcc.getInboxAccount(tenantId, accountId)
      if (!account) return null
      if (account.agentAutoReply === false) return null
      agentId = account.assignedAgentId ?? undefined
    }
    if (!agentId) return null

    const agent = await getAgentForMember(tenantId, agentId)
    return agent ? { agentId, agent } : null
  }

  // Instagram
  const convo = await ig.getConversation(tenantId, accountId, contactId)
  if (convo?.agentPaused || convo?.agentHandedOff) return null

  let agentId = convo?.assignedAgentId ?? undefined
  if (!agentId) {
    const account = await igAcc.getInboxAccount(tenantId, accountId)
    if (!account) return null
    if (account.agentAutoReply === false) return null
    agentId = account.assignedAgentId ?? undefined
  }
  if (!agentId) return null

  const agent = await getAgentForMember(tenantId, agentId)
  return agent ? { agentId, agent } : null
}
