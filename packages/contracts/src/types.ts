import type { Message } from './message'
// AgentMode and QuickSuggestionsMode have canonical definitions in
// domain-types — types.ts originally duplicated them. Import here so
// the barrel in index.ts can re-export the contracts namespace cleanly.
import type { AgentMode, QuickSuggestionsMode } from './domain-types'

// TODO refactor and remove unneccessary duplicate data.
export interface Chat extends Record<string, any> {
  id: string
  title: string
  createdAt: Date
  userId: string
  path: string
  messages: Message[]
  sharePath?: string // Refactor to use RLS
}

export type BuiltinToolType =
  | 'builtin:web_fetch'
  | 'builtin:file_search'
  | 'builtin:bash'

export type ActionToolType =
  | 'action:check_availability'
  | 'action:book_appointment'
  | 'action:reschedule_appointment'
  | 'action:cancel_appointment'
  | 'action:list_appointments'
  | 'action:check_booking_availability'
  | 'action:create_booking'
  | 'action:list_bookings'
  | 'action:update_booking'
  | 'action:cancel_booking'
  | 'action:submit_data'
  | 'action:update_record'
  | 'action:query_records'
  | 'action:delete_record'

export type AgentToolType = BuiltinToolType | ActionToolType

export type RetrievalStrategy = 'direct' | 'rag' | 'bash'

// AgentMode and QuickSuggestionsMode are imported from domain-types
// (single source of truth — see the import block above).

export type CollectionFieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'long_text'
  | 'choice'

export interface CollectionField {
  id: string
  label: string
  type: CollectionFieldType
  required: boolean
  description?: string
  choices?: string[]
  order: number
}

export interface VibeAgentTool {
  id: string
  type: AgentToolType
  name: string
  description?: string
  config?: Record<string, any>
}

export interface AgentAction {
  id: string
  type: 'appointments' | 'booking' | 'data'
  enabled: boolean
  connectionId?: string | null
  config: Record<string, any>
}

export interface VibeAgent {
  id: string
  userId: string
  tenantId: string
  tenantSlug?: string
  name: string
  instructions: string
  fileKeys: string[]
  agentUrl: string
  tools: VibeAgentTool[]
  allowAnonymous: boolean
  /**
   * Whether an access-gate password is set. Deliberately a boolean, not the
   * hash: this type is serialized into the RSC payload of the public gated
   * pages, so anything here is visible to anonymous visitors. Server code
   * that must verify a password uses getAgentAccessPasswordHash().
   */
  hasAccessPassword?: boolean
  greetingText?: string | null
  mode: AgentMode
  maxResponses?: number | null
  maxAgentResponses?: number | null
  totalResponseCount?: number
  quickSuggestionsMode?: QuickSuggestionsMode
  quickSuggestionsCount?: number | null
  sourceUrls?: string[]
  domain?: string | null
  retrievalStrategy?: RetrievalStrategy
  lastEmbeddingsSyncAt?: string | null
  googleReviewEnabled?: boolean
  googlePlaceId?: string | null
  notificationConfig?: {
    enabled: boolean
    events: Array<'completed' | 'handoff' | 'agent_handoff'>
    inApp: { enabled: boolean }
    email: { enabled: boolean; address?: string | null }
    webhook: { enabled: boolean; url?: string | null; secret?: string | null }
  }
  handoffTargets?: string[]
  collectionFields?: CollectionField[]
  schedulingConfig?: {
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
  dataConfig?: {
    enabled: boolean
    dataConnectionId: string | null
    fieldMappings: Array<{ collectionFieldId: string; targetColumn: string }>
    autoSubmitOnComplete: boolean
    updateKeyField?: string | null
  }
  calendarAvailabilityConfig?: {
    enabled: boolean
    calendarConnectionId: string | null
    calendarId?: string | null
    resourceName?: string
  }
  bookingConfig?: {
    enabled: boolean
    resources: Array<{
      id: string
      name: string
      calendarConnectionId: string
      calendarId: string
      calendarName: string
      timezone: string
    }>
    mode?: 'enquiry' | 'direct'
    eventTitleTemplate?: string
    eventTimeMode?: 'all-day' | 'timed'
    overlapProtection?: boolean
  }
  actions?: AgentAction[]
  llmConfigId?: string | null
  memoryEnabled?: boolean
  currentVersion?: number
  createdAt: string
  updatedAt: string
}

/**
 * The strict allow-list of agent fields that are safe to serialize into the
 * RSC payload of a public or gated agent page — i.e. everything the browser
 * chat UI actually reads, and nothing else. A `VibeAgent` is structurally
 * assignable to this, so the authenticated dashboard can keep passing the full
 * object; anonymous pages must pass `toPublicAgent(agent)` instead.
 *
 * Do NOT widen this to carry `instructions`, `fileKeys`, `tenantId`, any
 * `*Config` object, or `notificationConfig` — those reach anonymous visitors,
 * and `notificationConfig.webhook.secret` in particular is a live HMAC key.
 */
export interface PublicAgent {
  id: string
  name: string
  mode: AgentMode
  greetingText?: string | null
  maxResponses?: number | null
  maxAgentResponses?: number | null
  totalResponseCount?: number
  quickSuggestionsMode?: QuickSuggestionsMode
  quickSuggestionsCount?: number | null
}

/** Allow-list pick — new columns on VibeAgent stay private by default. */
export function toPublicAgent(agent: PublicAgent): PublicAgent {
  return {
    id: agent.id,
    name: agent.name,
    mode: agent.mode,
    greetingText: agent.greetingText ?? null,
    maxResponses: agent.maxResponses ?? null,
    maxAgentResponses: agent.maxAgentResponses ?? null,
    totalResponseCount: agent.totalResponseCount,
    quickSuggestionsMode: agent.quickSuggestionsMode,
    quickSuggestionsCount: agent.quickSuggestionsCount ?? null
  }
}

export interface VibeAgentConversation {
  id: string
  agentId: string
  userId?: string | null
  externalId?: string | null
  summary?: string | null
  messages: Message[]
  closedAt?: string | null
  handedOff?: boolean
  handoffChain?: Array<{
    fromAgentId: string
    fromAgentName: string
    toAgentId: string
    toAgentName: string
    timestamp: string
  }>
  responseCounts?: Record<string, number>
  summaryGeneratedAt?: string | null
  summaryResponseCount?: number
  feedback?: {
    rating: 'positive' | 'negative'
    comment?: string
    createdAt: string
  }
  createdAt: string
  updatedAt: string
}

export interface AgentLink {
  id: string
  tenantId: string
  slug: string
  agentId: string
  name: string
  description?: string | null
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface AgentSharePayload {
  url: string
  qrDataUrl: string
}

export type ServerActionResult<Result> = Promise<
  | Result
  | {
      error: string
    }
>
