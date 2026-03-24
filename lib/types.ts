import { type Message } from 'ai'

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

export type AgentToolType =
  | 'builtin:web_fetch'
  | 'builtin:search'
  | 'builtin:file_search'

export type AgentMode = 'provider' | 'collector'

export type QuickSuggestionsMode = 'off' | 'smart' | 'always'

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
  maxMessages?: number | null
  quickSuggestionsMode?: QuickSuggestionsMode
  quickSuggestionsCount?: number | null
  sourceUrls?: string[]
  lastEmbeddingsSyncAt?: string | null
  googleReviewEnabled?: boolean
  googlePlaceId?: string | null
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
  summaryGeneratedAt?: string | null
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
