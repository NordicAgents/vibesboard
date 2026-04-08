import { type Message } from '@/lib/types/message'

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
  | 'action:book_meeting'
  | 'action:reschedule_meeting'
  | 'action:cancel_meeting'
  | 'action:submit_data'
  | 'action:update_record'

export type AgentToolType = BuiltinToolType | ActionToolType

export type RetrievalStrategy = 'direct' | 'rag' | 'bash'

export type AgentMode = 'provider' | 'collector'

export type QuickSuggestionsMode = 'off' | 'smart' | 'always'

export type CollectionFieldType = 'text' | 'email' | 'phone' | 'number' | 'long_text' | 'choice'

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

export interface VibeAgent {
  id: string
  userId: string
  tenantId?: string
  tenantSlug?: string
  name: string
  instructions: string
  fileKeys: string[]
  agentUrl: string
  tools: VibeAgentTool[]
  allowAnonymous: boolean
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
  }
  createdAt: string
  updatedAt: string
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
