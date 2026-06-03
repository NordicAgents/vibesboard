// Vector embedding write sentinel. Embeddings are plain number[] at rest;
// this alias is retained so the chunk shapes below still type-check.
type EmbeddingWriteValue = unknown

// Plan identifier — defined here (rather than in a separate plans module) so
// contracts has no internal cross-file imports beyond the type re-exports
// from ./message. The runtime plan definitions (DEFAULT_PLANS, etc.) live in
// apps/web/lib/plans.ts and will move to @vibesboard/billing in Phase 9.
export type PlanId = 'free' | 'pro' | 'team' | 'enterprise'

// ─── Shared enums / unions ───────────────────────────────────────────
export type TenantRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
export type InvitationRole = 'TENANT_ADMIN' | 'MEMBER'
export type TenantStatus = 'active' | 'pending' | 'trial' | 'suspended'
export type InvitationStatus = 'pending' | 'accepted' | 'expired'
export type AgentMode = 'provider' | 'collector'
export type QuickSuggestionsMode = 'off' | 'smart' | 'always'
export type FileStatus = 'pending' | 'processing' | 'indexed' | 'failed'
export type ChatwootConnectionStatus = 'active' | 'disconnected' | 'error'

// ─── Calendar & Scheduling ──────────────────────────────────────────
export type CalendarProvider = 'google_calendar' | 'cal_com'
export type CalendarConnectionStatus = 'active' | 'disconnected' | 'expired'
export type BookingStatus = 'confirmed' | 'cancelled' | 'rescheduled'

export interface AgentSchedulingConfig {
  enabled: boolean
  calendarConnectionId: string | null
  defaultDurationMinutes: number
  bufferMinutes: number
  timezone: string
  availableHours: { start: string; end: string }
  availableDays: number[]
  meetingTitleTemplate: string
  meetingDescription?: string
  createMeetLink: boolean
}

// ─── Data & Database Actions ────────────────────────────────────────
export type DataProvider = 'google_sheets' | 'airtable' | 'custom_webhook'
export type DataConnectionStatus = 'active' | 'disconnected' | 'expired'
export type DataActionType =
  | 'append_row'
  | 'update_row'
  | 'webhook_submit'
  | 'query_row'
  | 'delete_row'

export interface DataFieldMapping {
  collectionFieldId: string // references CollectionField.id
  targetColumn: string // column header (Sheets) or field name (Airtable)
}

export interface AgentDataConfig {
  enabled: boolean
  dataConnectionId: string | null
  fieldMappings: DataFieldMapping[]
  autoSubmitOnComplete: boolean // auto-push when collector-mode completes
  updateKeyField?: string | null // field used to find existing rows for updates
}

// ─── Simple Booking ─────────────────────────────────────────────────
export interface BookableResource {
  id: string
  name: string
  calendarConnectionId: string
  calendarId: string
  calendarName: string
  timezone: string
}

export type BookingMode = 'enquiry' | 'direct'

export interface AgentBookingConfig {
  enabled: boolean
  resources: BookableResource[]
  mode?: BookingMode
  eventTitleTemplate?: string
  eventTimeMode?: 'all-day' | 'timed'
  overlapProtection?: boolean
}

export interface BookingEnquiryDocument {
  id: string
  agentId: string
  tenantId: string
  resourceName: string
  calendarId: string
  calendarName: string
  timezone: string
  startDatetime: string
  endDatetime: string
  guestName: string
  guestEmail: string
  guestPhone: string
  guestCount?: number
  notes?: string
  createdAt: string
}

// ─── Calendar Availability ──────────────────────────────────────────
export interface AgentCalendarAvailabilityConfig {
  enabled: boolean
  calendarConnectionId: string | null
  calendarId?: string | null // specific calendar to check — overrides the connection's default
  resourceName?: string // e.g. "Glass Cabin", "Conference Room A"
}

// ─── Agent notifications ────────────────────────────────────────────
export type NotificationEvent = 'completed' | 'handoff' | 'agent_handoff'

export interface AgentNotificationConfig {
  enabled: boolean
  events: NotificationEvent[]
  inApp: { enabled: boolean }
  email: { enabled: boolean; address?: string | null }
  webhook: { enabled: boolean; url?: string | null; secret?: string | null }
}

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

// ─── Usage metering ─────────────────────────────────────────────────
export type UsageSource =
  | 'chat' // in-app agent chat
  | 'ask_ai' // conversation analysis
  | 'public_chat' // anonymous agent link
  | 'hook_chat' // hook /chat endpoint
  | 'hook_stream' // hook /stream endpoint
  | 'hook_async' // hook /async endpoint
  | 'whatsapp' // WhatsApp messages
  | 'instagram' // Instagram messages
  | 'embed' // embed widget

export interface TenantSubscription {
  planId: PlanId
  seatCount: number // 1 for Free/Pro, 3+ for Team
  billingCycleStart: string // ISO date, start of current billing cycle
  billingCycleEnd: string // ISO date, end of current billing cycle
  messageCount: number // messages used in current cycle
  messageLimit: number // computed: plan.includedMessages or seatCount * plan.includedMessagesPerSeat
  overageCount: number // messages beyond limit in current cycle
  customMessageLimit?: number | null // admin override — null = use plan default
  customOverageRate?: number | null // admin override — null = use plan default
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  stripeOverageItemId: string | null // Stripe subscription item ID for metered overage line
}

/** /plan_templates/{planId} */
export interface PlanTemplateDocument {
  id: string
  name: string
  price: number // monthly price in cents
  pricePerSeat?: number | null // cents per seat (Team only)
  minSeats?: number | null // minimum seats (Team only)
  includedMessages: number // per month
  includedMessagesPerSeat?: number | null // Team only
  overageRate: number // cents per message (0 = hard cap)
  featureFlags: string[] // FeatureFlagName[] stored as strings
  createdAt: string
  updatedAt: string
  // Stripe integration
  stripeProductId?: string | null
  stripeBasePriceId?: string | null
  stripeOveragePriceId?: string | null
  pendingPriceMigration?: {
    oldBasePriceId: string
    oldOveragePriceId: string
    newBasePriceId: string
    newOveragePriceId: string
    createdAt: string
  } | null
}

/** /tenants/{tenantId}/usage_logs/{logId} */
export interface UsageLogDocument {
  id: string
  tenantId: string
  agentId: string
  conversationId: string | null
  userId: string | null // null for anonymous/public chat
  timestamp: string // ISO datetime
  source: UsageSource
  model: string // e.g. 'gpt-4o-mini', 'gpt-4o'
  inputTokens: number // from API response usage
  outputTokens: number // from API response usage
  totalTokens: number
  retrievalStrategy: 'direct' | 'rag' | 'bash' | null
  toolCalled: string | null
  latencyMs: number
  billingCycleId: string // YYYY-MM format for easy querying
}

/** Per-user per-agent token usage breakdown */
export interface UserAgentUsage {
  messages: number
  inputTokens: number
  outputTokens: number
}

/** Per-user usage with nested agent breakdown */
export interface UserUsage {
  messages: number
  inputTokens: number
  outputTokens: number
  byAgent: Record<string, UserAgentUsage>
}

/** /tenants/{tenantId}/usage_rollups/{billingCycleId} */
export interface UsageRollupDocument {
  tenantId: string
  billingCycleId: string // YYYY-MM
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  bySource: Partial<Record<UsageSource, number>>
  byAgent: Record<string, number>
  byModel: Record<string, number>
  byUser: Record<string, UserUsage> // user -> agents -> tokens hierarchy
  updatedAt: string
}

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
  subscription?: TenantSubscription
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
  /** Tracks which fields the tenant has explicitly customized.
   *  Missing = legacy (treat as fully overridden). Empty = fully inherited. */
  overrides?: BrandingField[]
  createdAt: string
  updatedAt: string
}

export type BrandingField = 'logoUrl' | 'primaryColor' | 'secondaryColor'

/** /platform_config/branding — singleton */
export interface PlatformBrandingDocument {
  logoUrl?: string
  primaryColor: string
  secondaryColor: string
  updatedAt: string
  updatedBy: string
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
  accessPassword?: string | null
  greetingText?: string
  quickSuggestionsMode: QuickSuggestionsMode
  quickSuggestionsCount: number
  mode: AgentMode
  maxResponses?: number
  maxAgentResponses?: number
  totalResponseCount?: number
  googleReviewEnabled?: boolean
  googlePlaceId?: string | null
  retrievalStrategy?: 'direct' | 'rag' | 'bash'
  lastEmbeddingsSyncAt?: string
  notificationConfig?: AgentNotificationConfig
  handoffTargets?: string[]
  collectionFields?: Array<{
    id: string
    label: string
    type: 'text' | 'email' | 'phone' | 'number' | 'long_text' | 'choice'
    required: boolean
    description?: string
    choices?: string[]
    order: number
  }>
  schedulingConfig?: AgentSchedulingConfig
  dataConfig?: AgentDataConfig
  calendarAvailabilityConfig?: AgentCalendarAvailabilityConfig
  bookingConfig?: AgentBookingConfig
  createdAt: string
  updatedAt: string
}

/** Handoff chain entry — tracks agent-to-agent transfers */
export interface HandoffChainEntry {
  fromAgentId: string
  fromAgentName: string
  toAgentId: string
  toAgentName: string
  timestamp: string
}

/** /tenants/{tenantId}/notifications/{notificationId} */
export interface NotificationDocument {
  id: string
  tenantId: string
  agentId: string
  agentName: string
  conversationId: string
  event: NotificationEvent
  summary?: string | null
  read: boolean
  createdAt: string
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
  id: string // nanoid(21) — used as the URL token
  agentId: string
  tenantId: string
  name: string // human label e.g. "Negotiation Service"
  secretHash: string // SHA-256 hex of the raw secret
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
  callbackStatus?: number // HTTP status returned by the callback endpoint
  callbackAttempts: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  failedAt?: string
}

/** /tenants/{tenantId}/agents/{agentId}/conversations/{id} */
export interface ConversationFeedback {
  rating: 'positive' | 'negative'
  comment?: string
  createdAt: string
}

export interface ConversationDocument {
  id: string
  agentId: string
  userId?: string
  externalId?: string
  messages: any[] // message objects stored inline
  summary?: string
  closedAt?: string
  summaryGeneratedAt?: string
  summaryResponseCount?: number
  handedOff?: boolean
  handoffChain?: HandoffChainEntry[]
  responseCounts?: Record<string, number>
  activeAgentId?: string
  feedback?: ConversationFeedback
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/agents/{agentId}/conversation_refs/{sourceConversationId} */
export interface ConversationRefDocument {
  id: string
  sourceAgentId: string
  sourceAgentName: string
  sourceConversationId: string
  role: 'active' | 'completed'
  responseCount: number
  summary?: string | null
  lastMessageAt: string
  createdAt: string
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
  embedding: number[] | EmbeddingWriteValue // vector value for writes
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
  embedding: number[] | EmbeddingWriteValue
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

  // Agent Bot (optional — absent for legacy connections)
  agentBotId?: number | null
  agentBotName?: string | null
  encryptedBotToken?: string | null
  useAgentBot?: boolean

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
  connectionMethod?: 'oauth' | 'api_key' | 'byoa'
  // BYOA (Bring Your Own App) fields — only set when connectionMethod is 'byoa'
  metaAppId?: string // Customer's own Meta App ID (cleartext)
  metaAppSecret?: string // Customer's Meta App Secret (AES encrypted)
  webhookVerifyToken?: string // Customer's webhook verify token (AES encrypted)
  byoaWebhookUrl?: string // Generated per-account webhook URL
  assignedAgentId?: string | null // default agent for all conversations
  agentAutoReply?: boolean // true = agent responds automatically
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
  assignedAgentId?: string | null // per-conversation agent override
  agentPaused?: boolean // human has paused agent on this conversation
  agentHandedOff?: boolean // agent triggered [HANDOFF_TO_HUMAN]
  agentConversationId?: string | null // link to agent ConversationDocument
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
  sentBy?: string // userId for outbound, or "agent:{agentId}" for agent-sent
  sentByAgentName?: string // denormalized agent name for UI badge
  createdAt: string
}

// ─── Instagram Inbox (OAuth-connected) ───────────────────────────────

export type InstagramInboxMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'story_mention'
  | 'story_reply'
  | 'media_share'

/** /tenants/{tenantId}/instagram_inbox_accounts/{accountId} */
export interface InstagramInboxAccountDocument {
  id: string
  tenantId: string
  instagramAccountId: string
  pageId: string
  pageName: string
  instagramUsername: string
  accessToken: string // AES encrypted page token
  scopes: string[]
  status: InboxAccountStatus
  connectedBy: string // userId
  connectedAt: string
  webhookSubscribed: boolean
  metaUserId?: string // Facebook app-scoped user ID (from OAuth)
  connectionMethod?: 'oauth' | 'api_key' | 'byoa'
  // BYOA (Bring Your Own App) fields — only set when connectionMethod is 'byoa'
  metaAppId?: string // Customer's own Meta App ID (cleartext)
  metaAppSecret?: string // Customer's Meta App Secret (AES encrypted)
  webhookVerifyToken?: string // Customer's webhook verify token (AES encrypted)
  byoaWebhookUrl?: string // Generated per-account webhook URL
  assignedAgentId?: string | null // default agent for all conversations
  agentAutoReply?: boolean // true = agent responds automatically
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/instagram_inbox_accounts/{accountId}/conversations/{contactIgsid} */
export interface InstagramInboxConversationDocument {
  id: string // same as contactIgsid
  accountId: string
  contactIgsid: string
  contactName?: string
  contactUsername?: string
  contactProfilePic?: string
  lastMessageAt: string
  lastMessagePreview: string
  unreadCount: number
  assignedTo?: string // userId
  assignedAgentId?: string | null // per-conversation agent override
  agentPaused?: boolean // human has paused agent on this conversation
  agentHandedOff?: boolean // agent triggered [HANDOFF_TO_HUMAN]
  agentConversationId?: string | null // link to agent ConversationDocument
  status: InboxConversationStatus
  windowExpiresAt: string // 24h from last inbound message
  createdAt: string
  updatedAt: string
}

/** .../conversations/{contactIgsid}/messages/{messageId} */
export interface InstagramInboxMessageDocument {
  id: string
  igMessageId: string // Meta's mid
  from: string
  to: string
  type: InstagramInboxMessageType
  text?: string
  mediaUrl?: string
  caption?: string
  direction: InboxMessageDirection
  status: InboxMessageStatus
  timestamp: string
  sentBy?: string // userId for outbound, or "agent:{agentId}" for agent-sent
  sentByAgentName?: string // denormalized agent name for UI badge
  createdAt: string
}

// ─── Calendar connections (tenant-scoped) ────────────────────────────

/** /tenants/{tenantId}/calendar_connections/{connectionId} */
export interface CalendarConnectionDocument {
  id: string
  tenantId: string
  provider: CalendarProvider
  name: string
  calendarId: string
  accessToken: string // AES encrypted
  refreshToken: string // AES encrypted
  tokenExpiresAt: string
  apiKey?: string // AES encrypted (Cal.com)
  apiBaseUrl?: string
  email?: string
  scopes: string[]
  status: CalendarConnectionStatus
  connectedBy: string
  connectedAt: string
  createdAt: string
  updatedAt: string
}

// ─── Bookings (agent-scoped) ────────────────────────────────────────

/** /tenants/{tenantId}/agents/{agentId}/bookings/{bookingId} */
export interface BookingDocument {
  id: string
  agentId: string
  tenantId: string
  conversationId: string
  calendarConnectionId: string
  provider: CalendarProvider
  externalEventId: string
  title: string
  startTime: string
  endTime: string
  timezone: string
  attendeeName: string
  attendeeEmail: string
  description?: string
  meetLink?: string
  status: BookingStatus
  cancelledAt?: string
  rescheduledTo?: string
  createdAt: string
  updatedAt: string
}

// ─── Data connections (tenant-scoped) ─────────────────────────────────

/** /tenants/{tenantId}/data_connections/{connectionId} */
export interface DataConnectionDocument {
  id: string
  tenantId: string
  provider: DataProvider
  name: string

  // Google Sheets (OAuth)
  accessToken?: string // AES encrypted
  refreshToken?: string // AES encrypted
  tokenExpiresAt?: string
  email?: string
  spreadsheetId?: string
  sheetName?: string
  scopes?: string[]

  // Airtable (personal access token)
  apiToken?: string // AES encrypted
  baseId?: string
  tableId?: string
  tableName?: string

  // Custom Webhook
  webhookUrl?: string
  webhookMethod?: 'POST' | 'PUT'
  webhookHeaders?: Record<string, string>

  // Common
  status: DataConnectionStatus
  connectedBy: string
  connectedAt: string
  createdAt: string
  updatedAt: string
}

/** /tenants/{tenantId}/agents/{agentId}/data_logs/{logId} */
export interface DataActionLogDocument {
  id: string
  agentId: string
  tenantId: string
  conversationId: string
  connectionId: string
  provider: DataProvider
  action: DataActionType
  status: 'success' | 'failed'
  rowData: Record<string, any>
  externalRef?: string // row number, Airtable record ID, etc.
  error?: string
  createdAt: string
}

// ─── Invite codes (gated access) ────────────────────────────────────

export interface InviteCodeRedemption {
  redeemedAt: string
  externalId: string
}

export interface InviteCodeDocument {
  id: string
  code: string
  createdAt: string
  expiresAt: string | null
  maxUses: number | null
  usedCount: number
  revoked: boolean
  redemptions: InviteCodeRedemption[]
}

// ─── Collection path helpers ─────────────────────────────────────────

export const Collections = {
  users: 'users',
  tenants: 'tenants',
  tenantSlugs: 'tenant_slugs',
  featureFlags: 'feature_flags',
  invitations: 'invitations',
  chats: 'chats',
  planTemplates: 'plan_templates',
  platformConfig: 'platform_config',

  // Tenant-scoped
  agentLinks: (tenantId: string) => `tenants/${tenantId}/agent_links` as const,
  branding: (tenantId: string) => `tenants/${tenantId}/branding` as const,
  members: (tenantId: string) => `tenants/${tenantId}/members` as const,
  featureToggles: (tenantId: string) =>
    `tenants/${tenantId}/feature_toggles` as const,
  agents: (tenantId: string) => `tenants/${tenantId}/agents` as const,
  notifications: (tenantId: string) =>
    `tenants/${tenantId}/notifications` as const,
  calendarConnections: (tenantId: string) =>
    `tenants/${tenantId}/calendar_connections` as const,
  dataConnections: (tenantId: string) =>
    `tenants/${tenantId}/data_connections` as const,

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
  bookings: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/bookings` as const,
  bookingEnquiries: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/bookingEnquiries` as const,
  dataLogs: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/data_logs` as const,
  hooks: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/hooks` as const,
  hookJobs: (tenantId: string, agentId: string, hookId: string) =>
    `tenants/${tenantId}/agents/${agentId}/hooks/${hookId}/jobs` as const,
  inviteCodes: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/invite_codes` as const,

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
    `tenants/${tenantId}/whatsapp_inbox_accounts/${accountId}/conversations/${contactPhone}/messages` as const,

  // Usage metering
  usageLogs: (tenantId: string) => `tenants/${tenantId}/usage_logs` as const,
  usageRollups: (tenantId: string) =>
    `tenants/${tenantId}/usage_rollups` as const,

  // Conversation refs (handoff visibility)
  conversationRefs: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/conversation_refs` as const,

  // Instagram Inbox (OAuth-connected)
  instagramInboxAccounts: (tenantId: string) =>
    `tenants/${tenantId}/instagram_inbox_accounts` as const,
  instagramInboxConversations: (tenantId: string, accountId: string) =>
    `tenants/${tenantId}/instagram_inbox_accounts/${accountId}/conversations` as const,
  instagramInboxMessages: (
    tenantId: string,
    accountId: string,
    contactId: string
  ) =>
    `tenants/${tenantId}/instagram_inbox_accounts/${accountId}/conversations/${contactId}/messages` as const
} as const
