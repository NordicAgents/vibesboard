import 'server-only'

import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import type {
  InstagramInboxAccountDocument,
  InstagramInboxConversationDocument
} from '@vibesboard/contracts'
import { getAgentForMember } from '@vibesboard/agents/server'
import type { VibeAgent } from '@vibesboard/contracts'
import * as wa from '@vibesboard/channel-whatsapp/conversations'
import * as waAcc from '@vibesboard/channel-whatsapp/accounts'

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
 */
export async function resolveInboxAgent(
  tenantId: string,
  accountId: string,
  contactId: string,
  channel: InboxChannel
): Promise<{ agentId: string; agent: VibeAgent } | null> {
  if (channel === 'whatsapp') {
    // WhatsApp data layer is on Postgres (Phase 5a).
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

  // Instagram still reads from Firestore until Phase 5b.
  const convoPath = Collections.instagramInboxConversations(tenantId, accountId)
  const convoSnap = await adminDb.collection(convoPath).doc(contactId).get()
  const convoData = convoSnap.exists
    ? (convoSnap.data() as InstagramInboxConversationDocument)
    : null

  if (convoData?.agentPaused || convoData?.agentHandedOff) {
    return null
  }

  let agentId = convoData?.assignedAgentId

  if (!agentId) {
    const accountPath = Collections.instagramInboxAccounts(tenantId)
    const accountSnap = await adminDb
      .collection(accountPath)
      .doc(accountId)
      .get()

    if (!accountSnap.exists) return null

    const accountData = accountSnap.data() as InstagramInboxAccountDocument

    if (accountData.agentAutoReply === false) return null

    agentId = accountData.assignedAgentId
  }

  if (!agentId) return null

  const agent = await getAgentForMember(tenantId, agentId)
  if (!agent) return null

  return { agentId, agent }
}
