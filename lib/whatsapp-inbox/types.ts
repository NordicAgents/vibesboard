import type {
  WhatsAppInboxAccountDocument,
  WhatsAppInboxConversationDocument,
  WhatsAppInboxMessageDocument,
  InboxConversationStatus,
  InboxMessageStatus,
} from '@/lib/firestore-types'

export type InboxAccount = WhatsAppInboxAccountDocument
export type InboxConversation = WhatsAppInboxConversationDocument
export type InboxMessage = WhatsAppInboxMessageDocument

export interface ConnectOAuthParams {
  tenantId: string
  code: string
  userId: string
}

export interface StoreInboundParams {
  tenantId: string
  accountId: string
  wabaId: string
  phoneNumberId: string
  message: MetaWebhookMessage
  contact?: MetaWebhookContact
}

export interface SendReplyParams {
  tenantId: string
  accountId: string
  contactPhone: string
  text: string
  userId: string
}

export interface PhoneNumberInfo {
  id: string
  display_phone_number: string
  verified_name: string
  quality_rating?: string
}

export interface MetaWebhookMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string; caption?: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  contacts?: any[]
}

export interface MetaWebhookContact {
  wa_id: string
  profile?: { name: string }
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
