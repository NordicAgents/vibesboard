import { type Retriever, type RetrieverConfig, type RetrievalStrategy } from './types'
import { DirectRetriever } from './strategies/direct'
import { RagRetriever } from './strategies/rag'

export function createRetriever(
  strategy: RetrievalStrategy,
  config: RetrieverConfig
): Retriever {
  switch (strategy) {
    case 'direct':
      return new DirectRetriever(config)
    case 'rag':
      return new RagRetriever(config)
    case 'bash':
      // Phase 3 — will return BashRetriever
      return new DirectRetriever(config)
    default:
      return new DirectRetriever(config)
  }
}

export type { Retriever, RetrieverConfig, RetrieverResult, RetrievalStrategy } from './types'
