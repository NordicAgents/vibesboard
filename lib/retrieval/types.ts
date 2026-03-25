import { type RegisteredTool } from '@/lib/agent/tools/base'
import { type RetrievalStrategy } from '@/lib/types'

export type { RetrievalStrategy }

export interface RetrieverConfig {
  agentId: string
  tenantId: string
  fileKeys: string[]
  sourceUrls?: string[]
}

export interface RetrieverResult {
  contextText: string
  tools: RegisteredTool[]
  sources: string[]
  hasOverflow: boolean
}

export interface Retriever {
  prepare(): Promise<void>
  build(): Promise<RetrieverResult>
  dispose(): Promise<void>
}
