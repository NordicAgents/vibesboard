import type {
  InstagramInboxAccountDocument,
  InstagramInboxConversationDocument,
  InstagramInboxMessageDocument
} from '@/lib/firestore-types'

export type InboxAccount = InstagramInboxAccountDocument
export type InboxConversation = InstagramInboxConversationDocument
export type InboxMessage = InstagramInboxMessageDocument

export interface ConnectOAuthParams {
  tenantId: string
  code: string
  userId: string
}

export interface ConnectApiKeyParams {
  tenantId: string
  accessToken: string
  pageId: string
  userId: string
}

export interface ConnectByoaParams {
  tenantId: string
  metaAppId: string
  metaAppSecret: string
  accessToken: string
  webhookVerifyToken: string
  pageId: string
  userId: string
}

export interface StoreInboundParams {
  tenantId: string
  accountId: string
  pageId: string
  message: InstagramWebhookMessage
  sender?: InstagramSenderInfo
}

export interface SendReplyParams {
  tenantId: string
  accountId: string
  contactIgsid: string
  text: string
  userId: string
  sentByAgentName?: string // set when reply is sent by an agent
}

export interface InstagramAccountInfo {
  id: string
  username: string
  name: string
  profile_picture_url?: string
}

export interface InstagramWebhookMessage {
  mid: string
  text?: string
  attachments?: Array<{
    type: string
    payload: { url: string }
  }>
  is_echo?: boolean
  is_deleted?: boolean
}

export interface InstagramSenderInfo {
  id: string
  username?: string
  name?: string
}

export interface MetaTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
}

export interface MetaDebugTokenData {
  app_id: string
  type: string
  is_valid: boolean
  granular_scopes: Array<{
    scope: string
    target_ids?: string[]
  }>
}
