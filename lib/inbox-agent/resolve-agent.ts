import 'server-only'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type {
  WhatsAppInboxAccountDocument,
  InstagramInboxAccountDocument,
  WhatsAppInboxConversationDocument,
  InstagramInboxConversationDocument
} from '@/lib/firestore-types'
import { getAgentForMember } from '@/lib/agents/server'
import type { VibeAgent } from '@/lib/types'

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
  // 1. Fetch conversation doc
  const convoPath =
    channel === 'whatsapp'
      ? Collections.whatsappInboxConversations(tenantId, accountId)
      : Collections.instagramInboxConversations(tenantId, accountId)

  const convoSnap = await adminDb.collection(convoPath).doc(contactId).get()
  const convoData = convoSnap.exists
    ? (convoSnap.data() as
        | WhatsAppInboxConversationDocument
        | InstagramInboxConversationDocument)
    : null

  // 2. Check conversation-level flags
  if (convoData?.agentPaused || convoData?.agentHandedOff) {
    return null
  }

  // 3. Determine effective agent ID: conversation override > account default
  let agentId = convoData?.assignedAgentId

  if (!agentId) {
    // Fall back to account-level assignment
    const accountPath =
      channel === 'whatsapp'
        ? Collections.whatsappInboxAccounts(tenantId)
        : Collections.instagramInboxAccounts(tenantId)

    const accountSnap = await adminDb
      .collection(accountPath)
      .doc(accountId)
      .get()

    if (!accountSnap.exists) return null

    const accountData = accountSnap.data() as
      | WhatsAppInboxAccountDocument
      | InstagramInboxAccountDocument

    // Check if auto-reply is enabled (default true when agent assigned)
    if (accountData.agentAutoReply === false) return null

    agentId = accountData.assignedAgentId
  }

  if (!agentId) return null

  // 4. Load the agent
  const agent = await getAgentForMember(tenantId, agentId)
  if (!agent) return null

  return { agentId, agent }
}
