/**
 * RAG Retriever Service
 * Advanced retrieval strategies for knowledge base search
 */

import {
  vectorSearchFileChunks,
  keywordSearchFileChunks,
  providerFromDimension,
} from '@vibesboard/ai/rag-store'
import { resolveEmbedder } from './tenant-llm-config.ts'

export interface RetrievalConfig {
  topK?: number
  /**
   * Cosine-similarity floor for vector results, 0..1. Chunks scoring below it
   * are dropped, so an unrelated question can retrieve nothing rather than
   * the least-bad matches in the corpus.
   *
   * Applies to vector search only — keyword-fallback rows carry no comparable
   * score (`similarity: null`) and are never filtered by it.
   *
   * Defaults to no floor. A sensible production value depends on the
   * embedding model and the corpus, so it is left to the caller rather than
   * guessed here: raising it blindly silently starves retrieval, and lowering
   * it does nothing.
   */
  minSimilarity?: number
  enableFallback?: boolean
  maxContextChars?: number
}

export interface RetrievedChunk {
  fileId: string
  fileName: string
  fileKey: string
  chunkIndex: number
  content: string
  similarity: number | null
  mimeType?: string
}

export interface RAGContext {
  chunks: RetrievedChunk[]
  context: string
  sources: string[]
  totalChunks: number
  usedVectorSearch: boolean
}

/**
 * Retrieve relevant chunks for a query using RAG
 */
export async function retrieveContext(
  tenantId: string,
  agentId: string,
  query: string,
  config: RetrievalConfig = {}
): Promise<RAGContext> {
  const {
    topK = 5,
    enableFallback = true,
    maxContextChars = 6000,
    minSimilarity
  } = config

  // 1. Try vector search first
  const rawVectorResults = await vectorSearch(tenantId, agentId, query, topK)

  // Apply the relevance floor before deciding whether vector search "found"
  // anything, so a set of matches that are all below it falls through to the
  // keyword fallback rather than returning weak results.
  const vectorResults =
    minSimilarity == null
      ? rawVectorResults
      : rawVectorResults.filter(
          chunk => chunk.similarity != null && chunk.similarity >= minSimilarity
        )

  if (vectorResults.length > 0) {
    return buildRAGContext(vectorResults, maxContextChars, true)
  }

  // 2. Fallback to keyword search
  if (enableFallback) {
    console.log(
      '[RAG] Vector search returned no results, trying keyword fallback'
    )
    const keywordResults = await keywordSearch(tenantId, agentId, query, topK)
    return buildRAGContext(keywordResults, maxContextChars, false)
  }

  return {
    chunks: [],
    context: '',
    sources: [],
    totalChunks: 0,
    usedVectorSearch: true
  }
}

/**
 * Vector similarity search using Postgres pgvector cosine distance
 */
async function vectorSearch(
  tenantId: string,
  agentId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  try {
    const embedding = await generateQueryEmbedding(query, tenantId)
    if (!embedding) {
      console.warn('[RAG] Failed to generate query embedding')
      return []
    }

    return vectorSearchFileChunks({ tenantId, agentId, queryEmbedding: embedding, topK, provider: providerFromDimension(embedding.length) })
  } catch (error) {
    console.error('[RAG] Vector search exception:', error)
    return []
  }
}

/**
 * Keyword-based search fallback using Postgres full-text search (tsvector)
 */
async function keywordSearch(
  tenantId: string,
  agentId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  try {
    return keywordSearchFileChunks({ tenantId, agentId, query, topK })
  } catch (error) {
    console.error('[RAG] Keyword search exception:', error)
    return []
  }
}

/**
 * Build formatted RAG context from retrieved chunks
 */
function buildRAGContext(
  chunks: RetrievedChunk[],
  maxChars: number,
  usedVectorSearch: boolean
): RAGContext {
  if (chunks.length === 0) {
    return {
      chunks: [],
      context: '',
      sources: [],
      totalChunks: 0,
      usedVectorSearch
    }
  }

  const uniqueSources = Array.from(new Set(chunks.map(chunk => chunk.fileName)))

  const contextParts: string[] = []
  let totalChars = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const sourceLabel = `[Source ${i + 1}: ${chunk.fileName}]`
    const chunkText = `${sourceLabel}\n${chunk.content.trim()}`

    if (totalChars + chunkText.length > maxChars) {
      const remaining = maxChars - totalChars
      if (remaining > 200) {
        contextParts.push(chunkText.slice(0, remaining) + '...')
      }
      break
    }

    contextParts.push(chunkText)
    totalChars += chunkText.length
  }

  const context = contextParts.join('\n\n---\n\n')

  return {
    chunks,
    context,
    sources: uniqueSources,
    totalChunks: chunks.length,
    usedVectorSearch
  }
}

async function generateQueryEmbedding(query: string, tenantId: string): Promise<number[] | null> {
  try {
    const embed = await resolveEmbedder(tenantId)
    const results = await embed([query.trim()])
    return results[0] ?? null
  } catch (error) {
    console.error('[RAG] Failed to generate embedding:', error)
    return null
  }
}

export function formatRAGPrompt(ragContext: RAGContext): string {
  if (!ragContext.context || ragContext.chunks.length === 0) {
    return ''
  }

  return `
You have access to the following knowledge base documents:

${ragContext.context}

Use the information from these sources to answer the user's question accurately. If the information is not in the provided documents, you can still use your general knowledge but make it clear what came from the documents vs. your general knowledge.

When citing information from the documents, mention the source (e.g., "According to [Source 1: filename.pdf]...").
`.trim()
}

export function formatSourceCitations(ragContext: RAGContext): string {
  if (ragContext.sources.length === 0) {
    return ''
  }

  const citations = ragContext.sources.map((source, i) => `${i + 1}. ${source}`)

  return `\n\n**Sources:**\n${citations.join('\n')}`
}
