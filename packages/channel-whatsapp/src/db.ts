import type {
  WhatsappAccount,
  WhatsappConversation,
  WhatsappMessage,
} from '@vibesboard/adapter-postgres/schema'
import type {
  WhatsAppInboxAccountDocument,
  WhatsAppInboxConversationDocument,
  WhatsAppInboxMessageDocument,
} from '@vibesboard/contracts'

export const rowToWhatsappAccount = (
  r: WhatsappAccount,
): WhatsAppInboxAccountDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  wabaId: r.wabaId,
  phoneNumberId: r.phoneNumberId,
  displayPhoneNumber: r.displayPhoneNumber,
  businessName: r.businessName,
  accessToken: r.accessTokenEncrypted,
  scopes: r.scopes ?? [],
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  webhookSubscribed: r.webhookSubscribed,
  connectionMethod: r.connectionMethod ?? undefined,
  metaAppId: r.metaAppId ?? undefined,
  metaAppSecret: r.metaAppSecretEncrypted ?? undefined,
  webhookVerifyToken: r.webhookVerifyTokenEncrypted ?? undefined,
  byoaWebhookUrl: r.byoaWebhookUrl ?? undefined,
  assignedAgentId: r.assignedAgentId ?? null,
  agentAutoReply: r.agentAutoReply,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const rowToWhatsappConversation = (
  r: WhatsappConversation,
): WhatsAppInboxConversationDocument => ({
  id: r.id,
  accountId: r.accountId,
  contactName: r.contactName ?? undefined,
  contactPhone: r.contactPhone,
  contactProfileName: r.contactProfileName ?? undefined,
  lastMessageAt: r.lastMessageAt.toISOString(),
  lastMessagePreview: r.lastMessagePreview,
  unreadCount: r.unreadCount,
  assignedTo: r.assignedTo ?? undefined,
  assignedAgentId: r.assignedAgentId ?? null,
  agentPaused: r.agentPaused,
  agentHandedOff: r.agentHandedOff,
  agentConversationId: r.agentConversationId ?? null,
  status: r.status,
  windowExpiresAt: r.windowExpiresAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const rowToWhatsappMessage = (
  r: WhatsappMessage,
): WhatsAppInboxMessageDocument => ({
  id: r.id,
  waMessageId: r.waMessageId,
  from: r.fromAddr,
  to: r.toAddr,
  type: r.type,
  text: r.text ?? undefined,
  mediaUrl: r.mediaUrl ?? undefined,
  caption: r.caption ?? undefined,
  direction: r.direction,
  status: r.status,
  timestamp: r.timestampOriginal.toISOString(),
  sentBy: r.sentBy ?? undefined,
  sentByAgentName: r.sentByAgentName ?? undefined,
  createdAt: r.createdAt.toISOString(),
})
