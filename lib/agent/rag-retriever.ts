/**
 * RAG Retriever Service
 * Advanced retrieval strategies for knowledge base search
 */

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { createEmbedding } from '@/lib/openai-compat'

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small'

export interface RetrievalConfig {
  topK?: number
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
  const { topK = 5, enableFallback = true, maxContextChars = 6000 } = config

  // 1. Try vector search first
  const vectorResults = await vectorSearch(tenantId, agentId, query, topK)

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
 * Vector similarity search using Firestore native findNearest
 */
async function vectorSearch(
  tenantId: string,
  agentId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  try {
    const embedding = await generateQueryEmbedding(query)
    if (!embedding) {
      console.warn('[RAG] Failed to generate query embedding')
      return []
    }

    const collPath = Collections.fileChunks(tenantId, agentId)
    const snapshot = await adminDb
      .collection(collPath)
      .findNearest('embedding', FieldValue.vector(embedding), {
        limit: topK,
        distanceMeasure: 'COSINE'
      })
      .get()

    if (snapshot.empty) return []

    return snapshot.docs.map((doc: any) => {
      const data = doc.data()
      return {
        fileId: data.fileId ?? '',
        fileName: data.fileName,
        fileKey: data.fileKey,
        chunkIndex: data.chunkIndex,
        content: data.content,
        similarity: null, // Firestore findNearest doesn't return distance scores
        mimeType: data.mimeType ?? undefined
      }
    })
  } catch (error) {
    console.error('[RAG] Vector search exception:', error)
    return []
  }
}

/**
 * Keyword-based search fallback
 */
async function keywordSearch(
  tenantId: string,
  agentId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  try {
    const collPath = Collections.fileChunks(tenantId, agentId)
    // Firestore doesn't support ILIKE / full-text search natively.
    // Load a broader set and filter in-memory, capped at 200 to avoid full-collection scans.
    const scanLimit = Math.min(topK * 10, 200)
    const snapshot = await adminDb.collection(collPath).limit(scanLimit).get()

    const queryLower = query.toLowerCase()
    return snapshot.docs
      .filter((doc: any) => {
        const content: string = doc.data().content ?? ''
        return content.toLowerCase().includes(queryLower)
      })
      .slice(0, topK)
      .map((doc: any) => {
        const data = doc.data()
        return {
          fileId: data.fileId ?? '',
          fileName: data.fileName,
          fileKey: data.fileKey,
          chunkIndex: data.chunkIndex,
          content: data.content,
          similarity: null, // keyword fallback — no similarity score available
          mimeType: data.mimeType ?? undefined
        }
      })
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

async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    const json = await createEmbedding({
      model: EMBEDDING_MODEL,
      input: query.trim()
    })

    const embedding = json?.data?.[0]?.embedding

    return embedding ?? null
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
