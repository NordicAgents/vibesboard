import type { FieldValue } from 'firebase-admin/firestore'

// ─── Shared enums / unions ───────────────────────────────────────────
export type TenantRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
export type InvitationRole = 'TENANT_ADMIN' | 'MEMBER'
export type TenantStatus = 'active' | 'trial' | 'suspended'
export type InvitationStatus = 'pending' | 'accepted' | 'expired'
export type AgentMode = 'provider' | 'collector'
export type QuickSuggestionsMode = 'off' | 'smart' | 'always'
export type FileStatus = 'pending' | 'processing' | 'indexed' | 'failed'
export type ChatwootConnectionStatus = 'active' | 'disconnected' | 'error'

// WhatsApp Inbox (OAuth-connected)
export type InboxAccountStatus = 'active' | 'disconnected' | 'expired'
export type InboxConversationStatus = 'open' | 'resolved' | 'snoozed'
export type InboxMessageDirection = 'inbound' | 'outbound'
export type InboxMessageStatus =
  | 'received'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
export type InboxMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'contacts'

// ─── Top-level collections ───────────────────────────────────────────

/** /users/{userId} */
export interface UserDocument {
  id: string
  email: string
  name?: string
  image?: string
  isSuperAdmin: boolean
  tenantIds: string[]
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId} */
export interface TenantDocument {
  id: string
  name: string
  slug: string
  status: TenantStatus
  createdBy: string
  isPersonal: boolean
  googlePlaceId?: string | null
  createdAt: string
  updatedAt: string
}

/** /tenant_slugs/{slug} — uniqueness lock + URL namespace */
export interface TenantSlugDocument {
  tenantId: string
  createdAt: string
}

/** /feature_flags/{flagId} */
export interface FeatureFlagDocument {
  id: string
  name: string
  description?: string
  defaultValue: boolean
  createdAt: string
}

/** /invitations/{token} — keyed by token for O(1) lookup */
export interface InvitationDocument {
  id: string
  email: string
  tenantId: string
  token: string
  role: InvitationRole
  status: InvitationStatus
  expiresAt: string
  acceptedAt?: string
  createdBy: string
  createdAt: string
}

/** /chats/{chatId} — legacy chats */
export interface ChatDocument {
  id: string
  userId?: string
  payload?: any
}

/** /tenants/{tenantId}/agent_links/{linkId} */
export interface AgentLinkDocument {
  id: string
  tenantId: string
  slug: string // unique within tenant, URL-safe
  agentId: string // currently-connected agent
  name: string // human label (e.g. "Front Desk QR")
  description?: string
  isActive: boolean // soft-disable without deleting
  createdBy: string // userId
  createdAt: string
  updatedAt: string
}

// ─── Tenant-scoped collections ───────────────────────────────────────

/** /tenants/{tenantId}/branding/{tenantId} — single doc */
export interface TenantBrandingDocument {
  tenantId: string
  logoUrl?: string
  primaryColor: string
  secondaryColor: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/members/{userId} */
export interface TenantMemberDocument {
  userId: string
  tenantId: string
  role: TenantRole
  createdAt: string
}

/** /tenants/{tenantId}/feature_toggles/{flagId} */
export interface TenantFeatureToggleDocument {
  tenantId: string
  featureFlagId: string
  featureFlagName: string // denormalized
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/agents/{agentId} */
export interface AgentDocument {
  id: string
  userId: string
  tenantId: string
  tenantSlug: string // denormalized for URL construction
  name: string
  instructions: string
  fileKeys: string[]
  agentUrl: string // slug — unique per-tenant
  tools: string[]
  allowAnonymous: boolean
  greetingText?: string
  quickSuggestionsMode: QuickSuggestionsMode
  quickSuggestionsCount: number
  mode: AgentMode
  maxMessages?: number
  googleReviewEnabled?: boolean
  googlePlaceId?: string | null
  retrievalStrategy?: 'direct' | 'rag' | 'bash'
  lastEmbeddingsSyncAt?: string
  createdAt: string
  updatedAt: string
}

// ─── Agent hook status ───────────────────────────────────────────────
export type HookStatus = 'active' | 'inactive'
export type HookJobStatus = 'pending' | 'running' | 'completed' | 'failed'

// ─── Agent-scoped collections ────────────────────────────────────────

/**
 * /tenants/{tenantId}/agents/{agentId}/hooks/{hookId}
 *
 * Exposes an agent to external callers (other agents, external services)
 * via a secret-authenticated HTTP endpoint. The secretKey is stored as a
 * SHA-256 hex digest — it is shown to the user once at creation and never
 * returned again.
 */
export interface HookDocument {
  id: string            // nanoid(21) — used as the URL token
  agentId: string
  tenantId: string
  name: string          // human label e.g. "Negotiation Service"
  secretHash: string    // SHA-256 hex of the raw secret
  status: HookStatus
  requestCount: number
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * /tenants/{tenantId}/agents/{agentId}/hooks/{hookId}/jobs/{jobId}
 *
 * Represents an async agent invocation. The caller submits a message and a
 * callbackUrl, gets back a jobId immediately (202), and vibeagent POSTs the
 * reply to callbackUrl when the agent completes. The caller can also poll
 * GET /api/hooks/{hookId}/jobs/{jobId} for status.
 */
export interface HookJobDocument {
  id: string
  hookId: string
  agentId: string
  tenantId: string
  message: string
  externalUserId?: string
  conversationId?: string
  callbackUrl: string
  status: HookJobStatus
  reply?: string
  error?: string
  callbackStatus?: number   // HTTP status returned by the callback endpoint
  callbackAttempts: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  failedAt?: string
}

/** /tenants/{tenantId}/agents/{agentId}/conversations/{id} */
export interface ConversationDocument {
  id: string
  agentId: string
  userId?: string
  externalId?: string
  messages: any[] // message objects stored inline
  summary?: string
  closedAt?: string
  summaryGeneratedAt?: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/agents/{agentId}/files/{id} */
export interface AgentFileDocument {
  id: string
  agentId: string
  tenantId: string
  userId: string
  fileKey: string
  fileName: string
  mimeType: string
  fileSize: number
  status: FileStatus
  processingError?: string
  processingStartedAt?: string
  processingCompletedAt?: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/agents/{agentId}/file_chunks/{id} */
export interface FileChunkDocument {
  id: string
  agentId: string
  fileKey: string
  fileName: string
  mimeType?: string
  chunkIndex: number
  content: string
  embedding: number[] | FieldValue // FieldValue.vector() for writes
  createdAt: string
}

/** /tenants/{tenantId}/agents/{agentId}/conversation_chunks/{id} */
export interface ConversationChunkDocument {
  id: string
  agentId: string
  conversationId: string
  messageIndex: number
  chunkIndex: number
  role: string
  content: string
  embedding: number[] | FieldValue
  createdAt: string
}

/** /tenants/{tenantId}/agents/{agentId}/chatwoot_connections/{id} */
export interface ChatwootConnectionDocument {
  id: string
  agentId: string
  tenantId: string
  userId: string

  // Chatwoot config
  chatwootUrl: string
  chatwootAccountId: number
  chatwootInboxId: number
  chatwootInboxName: string
  encryptedApiToken: string
  chatwootWebhookId: number | null

  // Webhook security
  webhookSecretHash: string

  // Status
  status: ChatwootConnectionStatus
  lastMessageReceivedAt?: string
  totalConversations: number
  disconnectedAt?: string
  disconnectionReason?: string
  errorMessage?: string

  createdAt: string
  updatedAt: string
}

// ─── WhatsApp Inbox (OAuth-connected) ────────────────────────────────

/** /tenants/{tenantId}/whatsapp_inbox_accounts/{accountId} */
export interface WhatsAppInboxAccountDocument {
  id: string
  tenantId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
  businessName: string
  accessToken: string // AES encrypted
  scopes: string[]
  status: InboxAccountStatus
  connectedBy: string // userId
  connectedAt: string
  webhookSubscribed: boolean
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/whatsapp_inbox_accounts/{accountId}/conversations/{contactPhone} */
export interface WhatsAppInboxConversationDocument {
  id: string // same as contactPhone
  accountId: string
  contactName?: string
  contactPhone: string
  contactProfileName?: string
  lastMessageAt: string
  lastMessagePreview: string
  unreadCount: number
  assignedTo?: string // userId
  status: InboxConversationStatus
  windowExpiresAt: string // 24h from last inbound message
  createdAt: string
  updatedAt: string
}

/** .../conversations/{contactPhone}/messages/{messageId} */
export interface WhatsAppInboxMessageDocument {
  id: string
  waMessageId: string
  from: string
  to: string
  type: InboxMessageType
  text?: string
  mediaUrl?: string
  caption?: string
  direction: InboxMessageDirection
  status: InboxMessageStatus
  timestamp: string
  sentBy?: string // userId for outbound
  createdAt: string
}

// ─── Collection path helpers ─────────────────────────────────────────

export const Collections = {
  users: 'users',
  tenants: 'tenants',
  tenantSlugs: 'tenant_slugs',
  featureFlags: 'feature_flags',
  invitations: 'invitations',
  chats: 'chats',

  // Tenant-scoped
  agentLinks: (tenantId: string) =>
    `tenants/${tenantId}/agent_links` as const,
  branding: (tenantId: string) => `tenants/${tenantId}/branding` as const,
  members: (tenantId: string) => `tenants/${tenantId}/members` as const,
  featureToggles: (tenantId: string) =>
    `tenants/${tenantId}/feature_toggles` as const,
  agents: (tenantId: string) => `tenants/${tenantId}/agents` as const,

  // Agent-scoped
  conversations: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/conversations` as const,
  agentFiles: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/files` as const,
  fileChunks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/file_chunks` as const,
  conversationChunks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/conversation_chunks` as const,
  chatwootConnections: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/chatwoot_connections` as const,
  hooks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/hooks` as const,
  hookJobs: (tenantId: string, agentId: string, hookId: string) =>
    `tenants/${tenantId}/agents/${agentId}/hooks/${hookId}/jobs` as const,

  // WhatsApp Inbox (OAuth-connected)
  whatsappInboxAccounts: (tenantId: string) =>
    `tenants/${tenantId}/whatsapp_inbox_accounts` as const,
  whatsappInboxConversations: (tenantId: string, accountId: string) =>
    `tenants/${tenantId}/whatsapp_inbox_accounts/${accountId}/conversations` as const,
  whatsappInboxMessages: (
    tenantId: string,
    accountId: string,
    contactPhone: string
  ) =>
    `tenants/${tenantId}/whatsapp_inbox_accounts/${accountId}/conversations/${contactPhone}/messages` as const
} as const
