import { type RegisteredTool } from '@/lib/agent/tools/base'

export type RetrievalStrategy = 'direct' | 'rag' | 'bash'

export interface RetrieverConfig {
  agentId: string
  tenantId: string
  fileKeys: string[]
  sourceUrls?: string[]
  fileContext?: string | null
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
