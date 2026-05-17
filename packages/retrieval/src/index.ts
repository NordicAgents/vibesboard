import {
  type Retriever,
  type RetrieverConfig,
  type RetrievalStrategy
} from './types.ts'
import { DirectRetriever } from './strategies/direct.ts'
import { RagRetriever } from './strategies/rag.ts'
import { BashRetriever } from './strategies/bash.ts'

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
      return new BashRetriever(config)
    default:
      return new DirectRetriever(config)
  }
}

export type {
  Retriever,
  RetrieverConfig,
  RetrieverResult,
  RetrievalStrategy
} from './types.ts'
