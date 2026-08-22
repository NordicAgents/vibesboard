import type {
  InstagramAccount,
  InstagramConversation,
  InstagramMessage,
} from '@vibesboard/adapter-postgres/schema'
import type {
  InstagramInboxAccountDocument,
  InstagramInboxConversationDocument,
  InstagramInboxMessageDocument,
} from '@vibesboard/contracts'

export const rowToInstagramAccount = (
  r: InstagramAccount,
): InstagramInboxAccountDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  instagramAccountId: r.instagramAccountId,
  pageId: r.pageId,
  pageName: r.pageName,
  instagramUsername: r.instagramUsername,
  accessToken: r.accessTokenEncrypted,
  scopes: r.scopes ?? [],
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  webhookSubscribed: r.webhookSubscribed,
  metaUserId: r.metaUserId ?? undefined,
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

export const rowToInstagramConversation = (
  r: InstagramConversation,
): InstagramInboxConversationDocument => ({
  id: r.id,
  accountId: r.accountId,
  contactIgsid: r.contactIgsid,
  contactName: r.contactName ?? undefined,
  contactUsername: r.contactUsername ?? undefined,
  contactProfilePic: r.contactProfilePic ?? undefined,
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

export const rowToInstagramMessage = (
  r: InstagramMessage,
): InstagramInboxMessageDocument => ({
  id: r.id,
  igMessageId: r.igMessageId,
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
