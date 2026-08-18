import { type RegisteredTool } from '@vibesboard/ai/tools/base'
import { type RetrievalStrategy } from '@vibesboard/contracts'

export type { RetrievalStrategy }

export interface RetrieverConfig {
  agentId: string
  tenantId: string
  fileKeys: string[]
  sourceUrls?: string[]
  /**
   * Whether the agent's "File search" tool toggle is on.
   *
   * The retrieval strategy decides *how* files reach the model; this decides
   * *whether* they may at all. The RAG strategy is entirely tool-driven, so
   * with this off it exposes no file tool and the agent cannot read uploads —
   * which is what turning the switch off says it does.
   *
   * Defaults to enabled when omitted, so a caller that does not model tool
   * toggles keeps the previous behavior.
   */
  fileSearchEnabled?: boolean
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
