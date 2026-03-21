import type { FieldValue } from 'firebase-admin/firestore'

// ─── Shared enums / unions ───────────────────────────────────────────
export type TenantRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
export type InvitationRole = 'TENANT_ADMIN' | 'MEMBER'
export type TenantStatus = 'active' | 'trial' | 'suspended'
export type InvitationStatus = 'pending' | 'accepted' | 'expired'
export type AgentMode = 'provider' | 'collector'
export type QuickSuggestionsMode = 'off' | 'smart' | 'always'
export type FileStatus = 'pending' | 'processing' | 'indexed' | 'failed'
export type WhatsAppConnectionStatus =
  | 'pending'
  | 'active'
  | 'disconnected'
  | 'expired'
export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type BusinessAccountStatus =
  | 'pending'
  | 'verified'
  | 'suspended'
  | 'disconnected'
export type QualityRating = 'GREEN' | 'YELLOW' | 'RED'
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
export type TemplateStatus = 'pending' | 'approved' | 'rejected'
export type QueueItemStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'

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
  lastEmbeddingsSyncAt?: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/whatsapp_business_accounts/{id} */
export interface WhatsAppBusinessAccountDocument {
  id: string
  tenantId: string
  phoneNumberId: string
  businessAccountId: string
  phoneNumber: string
  phoneNumberNormalized: string
  accessToken: string
  status: BusinessAccountStatus
  qualityRating?: QualityRating
  messagingLimit?: string
  displayName?: string
  timezone: string
  verifiedAt?: string
  webhookVerified: boolean
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/whatsapp_contacts/{id} */
export interface WhatsAppContactDocument {
  id: string
  tenantId: string
  phoneNumber: string
  phoneNumberNormalized: string
  name?: string
  email?: string
  optedIn: boolean
  optedInAt?: string
  optedOutAt?: string
  optInSource?: string
  customFields: Record<string, any>
  tags: string[]
  listIds: string[] // denormalized: which lists this contact belongs to
  source: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/whatsapp_contact_lists/{id} */
export interface WhatsAppContactListDocument {
  id: string
  tenantId: string
  name: string
  description?: string
  contactIds: string[] // denormalized: which contacts are in this list
  totalContacts: number
  optedInCount: number
  tags: string[]
  createdBy?: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/whatsapp_campaigns/{id} */
export interface WhatsAppCampaignDocument {
  id: string
  tenantId: string
  businessAccountId: string
  name: string
  description?: string
  templateId: string
  templateVariables: Record<string, string>
  contactListIds: string[]
  filterCriteria?: any
  status: CampaignStatus
  scheduledAt?: string
  startedAt?: string
  completedAt?: string
  pausedAt?: string
  totalRecipients: number
  messagesSent: number
  messagesDelivered: number
  messagesRead: number
  messagesFailed: number
  messagesPending: number
  maxMessagesPerSecond: number
  createdBy?: string
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

/** /tenants/{tenantId}/agents/{agentId}/whatsapp_connections/{id} */
export interface WhatsAppAgentConnectionDocument {
  id: string
  agentId: string
  userId: string
  phoneNumber: string
  phoneNumberNormalized: string
  status: WhatsAppConnectionStatus
  customIntroMessage?: string
  introMessageSentAt?: string
  introMessageId?: string
  lastMessageReceivedAt?: string
  totalConversations: number
  connectedAt?: string
  disconnectedAt?: string
  expiresAt?: string
  disconnectionReason?: string
  createdAt: string
  updatedAt: string
}

// ─── Campaign-scoped collections ─────────────────────────────────────

/** /tenants/{tenantId}/whatsapp_campaigns/{id}/message_queue/{id} */
export interface MessageQueueDocument {
  id: string
  campaignId: string
  businessAccountId: string
  contactId?: string
  toPhoneNumber: string
  templateId?: string
  templateName: string
  templateLanguage: string
  templateVariables: Record<string, string>
  status: QueueItemStatus
  attempts: number
  maxAttempts: number
  messageId?: string // WhatsApp message ID once sent
  error?: string
  sentAt?: string
  deliveredAt?: string
  readAt?: string
  failedAt?: string
  createdAt: string
  updatedAt: string
}

// ─── WhatsApp templates (stored on business accounts) ────────────────

export interface TemplateButton {
  type: 'url' | 'phone_number' | 'quick_reply'
  text: string
  url?: string
  phoneNumber?: string
}

/** /tenants/{tenantId}/whatsapp_business_accounts/{id}/templates/{id} */
export interface MessageTemplateDocument {
  id: string
  businessAccountId: string
  name: string
  language: string
  category: TemplateCategory
  headerType?: 'text' | 'image' | 'video' | 'document'
  headerText?: string
  headerMediaUrl?: string
  bodyText: string
  footerText?: string
  variables: string[]
  buttons: TemplateButton[]
  status: TemplateStatus
  metaTemplateId?: string
  rejectionReason?: string
  totalSent: number
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
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
  branding: (tenantId: string) => `tenants/${tenantId}/branding` as const,
  members: (tenantId: string) => `tenants/${tenantId}/members` as const,
  featureToggles: (tenantId: string) =>
    `tenants/${tenantId}/feature_toggles` as const,
  agents: (tenantId: string) => `tenants/${tenantId}/agents` as const,
  whatsappBusinessAccounts: (tenantId: string) =>
    `tenants/${tenantId}/whatsapp_business_accounts` as const,
  whatsappContacts: (tenantId: string) =>
    `tenants/${tenantId}/whatsapp_contacts` as const,
  whatsappContactLists: (tenantId: string) =>
    `tenants/${tenantId}/whatsapp_contact_lists` as const,
  whatsappCampaigns: (tenantId: string) =>
    `tenants/${tenantId}/whatsapp_campaigns` as const,

  // Agent-scoped
  conversations: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/conversations` as const,
  agentFiles: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/files` as const,
  fileChunks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/file_chunks` as const,
  conversationChunks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/conversation_chunks` as const,
  whatsappConnections: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/whatsapp_connections` as const,
  hooks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/hooks` as const,
  hookJobs: (tenantId: string, agentId: string, hookId: string) =>
    `tenants/${tenantId}/agents/${agentId}/hooks/${hookId}/jobs` as const,

  // Campaign-scoped
  messageQueue: (tenantId: string, campaignId: string) =>
    `tenants/${tenantId}/whatsapp_campaigns/${campaignId}/message_queue` as const,

  // Template sub-collection on business accounts
  templates: (tenantId: string, businessAccountId: string) =>
    `tenants/${tenantId}/whatsapp_business_accounts/${businessAccountId}/templates` as const
} as const
