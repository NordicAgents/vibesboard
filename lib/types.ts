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
  | 'builtin:web'
  | 'builtin:file_search'

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
  name: string
  instructions: string
  fileKeys: string[]
  agentUrl: string
  tools: VibeAgentTool[]
  allowAnonymous: boolean
  greetingText?: string | null
  lastEmbeddingsSyncAt?: string | null
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
