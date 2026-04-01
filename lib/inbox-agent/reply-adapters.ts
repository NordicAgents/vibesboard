import 'server-only'

import { sendReply as sendWhatsAppReply } from '@/lib/whatsapp-inbox/messages'
import { sendReply as sendInstagramReply } from '@/lib/instagram-inbox/messages'

export interface InboxReplyParams {
  tenantId: string
  accountId: string
  contactId: string
  text: string
  agentId: string
  agentName: string
}

/**
 * Send a reply via WhatsApp on behalf of an agent.
 */
export async function sendWhatsAppAgentReply(params: InboxReplyParams) {
  return sendWhatsAppReply({
    tenantId: params.tenantId,
    accountId: params.accountId,
    contactPhone: params.contactId,
    text: params.text,
    userId: `agent:${params.agentId}`,
    sentByAgentName: params.agentName,
  })
}

/**
 * Send a reply via Instagram on behalf of an agent.
 */
export async function sendInstagramAgentReply(params: InboxReplyParams) {
  return sendInstagramReply({
    tenantId: params.tenantId,
    accountId: params.accountId,
    contactIgsid: params.contactId,
    text: params.text,
    userId: `agent:${params.agentId}`,
    sentByAgentName: params.agentName,
  })
}
