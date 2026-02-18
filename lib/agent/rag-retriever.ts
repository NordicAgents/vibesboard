/**
 * RAG Retriever Service
 * Advanced retrieval strategies for knowledge base search
 *
 * Best Practices Implemented:
 * - Hybrid search (vector + keyword fallback)
 * - Re-ranking by relevance
 * - Context window optimization
 * - Source attribution
 * - Configurable retrieval parameters
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { Configuration, OpenAIApi } from 'openai-edge'
import { type Database } from '@/lib/db_types'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small'

const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY
  })
)

export interface RetrievalConfig {
  /** Number of chunks to retrieve (default: 5) */
  topK?: number
  /** Minimum similarity threshold 0-1 (default: 0.7) */
  minSimilarity?: number
  /** Enable keyword fallback if vector search fails (default: true) */
  enableFallback?: boolean
  /** Maximum characters in combined context (default: 6000) */
  maxContextChars?: number
}

export interface RetrievedChunk {
  fileId: string
  fileName: string
  fileKey: string
  chunkIndex: number
  content: string
  similarity: number
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
 *
 * @param agentId - The agent ID to search within
 * @param query - User's question or search query
 * @param config - Retrieval configuration options
 * @returns RAG context with chunks and formatted context string
 */
export async function retrieveContext(
  agentId: string,
  query: string,
  config: RetrievalConfig = {}
): Promise<RAGContext> {
  const {
    topK = 5,
    minSimilarity = 0.7,
    enableFallback = true,
    maxContextChars = 6000
  } = config

  const supabase = getServiceSupabaseClient()

  // 1. Try vector search first
  const vectorResults = await vectorSearch(supabase, agentId, query, topK, minSimilarity)

  if (vectorResults.length > 0) {
    return buildRAGContext(vectorResults, maxContextChars, true)
  }

  // 2. Fallback to keyword search if vector search returns nothing
  if (enableFallback) {
    console.log('[RAG] Vector search returned no results, trying keyword fallback')
    const keywordResults = await keywordSearch(supabase, agentId, query, topK)
    return buildRAGContext(keywordResults, maxContextChars, false)
  }

  // 3. No results found
  return {
    chunks: [],
    context: '',
    sources: [],
    totalChunks: 0,
    usedVectorSearch: true
  }
}

/**
 * Vector similarity search using embeddings
 */
async function vectorSearch(
  supabase: SupabaseClient<Database>,
  agentId: string,
  query: string,
  topK: number,
  minSimilarity: number
): Promise<RetrievedChunk[]> {
  try {
    // 1. Generate query embedding
    const embedding = await generateQueryEmbedding(query)
    if (!embedding) {
      console.warn('[RAG] Failed to generate query embedding')
      return []
    }

    // 2. Search for similar chunks
    const { data: matches, error } = await supabase.rpc('match_agent_file_chunks', {
      agent_id: agentId,
      query_embedding: embedding,
      match_count: topK
    })

    if (error) {
      console.error('[RAG] Vector search error:', error)
      return []
    }

    if (!matches || matches.length === 0) {
      return []
    }

    // 3. Filter by minimum similarity and get file metadata
    const chunks: RetrievedChunk[] = []

    for (const match of matches) {
      const similarity = match.similarity ?? 0

      if (similarity < minSimilarity) {
        continue
      }

      // Get file_id from chunk
      const { data: chunkData } = await supabase
        .from('agent_file_chunks')
        .select('file_id')
        .eq('agent_id', agentId)
        .eq('file_key', match.file_key)
        .eq('chunk_index', match.chunk_index)
        .maybeSingle()

      chunks.push({
        fileId: chunkData?.file_id ?? '',
        fileName: match.file_name,
        fileKey: match.file_key,
        chunkIndex: match.chunk_index,
        content: match.content,
        similarity,
        mimeType: match.mime_type ?? undefined
      })
    }

    // 4. Re-rank by similarity (already sorted by RPC, but ensure)
    chunks.sort((a, b) => b.similarity - a.similarity)

    return chunks
  } catch (error) {
    console.error('[RAG] Vector search exception:', error)
    return []
  }
}

/**
 * Keyword-based search fallback using PostgreSQL full-text search
 */
async function keywordSearch(
  supabase: SupabaseClient<Database>,
  agentId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  try {
    // Use ILIKE for simple keyword matching (can be improved with ts_vector later)
    const { data: matches, error } = await supabase
      .from('agent_file_chunks')
      .select('file_id, file_key, file_name, chunk_index, content, mime_type')
      .eq('agent_id', agentId)
      .ilike('content', `%${query}%`)
      .limit(topK)

    if (error || !matches) {
      console.error('[RAG] Keyword search error:', error)
      return []
    }

    return matches.map(match => ({
      fileId: match.file_id ?? '',
      fileName: match.file_name,
      fileKey: match.file_key,
      chunkIndex: match.chunk_index,
      content: match.content,
      similarity: 0.5, // Default similarity for keyword matches
      mimeType: match.mime_type ?? undefined
    }))
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

  // 1. Deduplicate sources
  const uniqueSources = Array.from(
    new Set(chunks.map(chunk => chunk.fileName))
  )

  // 2. Build context string with source attribution
  const contextParts: string[] = []
  let totalChars = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const sourceLabel = `[Source ${i + 1}: ${chunk.fileName}]`
    const chunkText = `${sourceLabel}\n${chunk.content.trim()}`

    // Check if adding this chunk would exceed max chars
    if (totalChars + chunkText.length > maxChars) {
      // Take partial chunk if we have room
      const remaining = maxChars - totalChars
      if (remaining > 200) {
        // Only include if we can get meaningful content
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

/**
 * Generate embedding for a query
 */
async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    const response = await openai.createEmbedding({
      model: EMBEDDING_MODEL,
      input: query.trim()
    })

    const json = await response.json()
    const embedding = json?.data?.[0]?.embedding

    return embedding ?? null
  } catch (error) {
    console.error('[RAG] Failed to generate embedding:', error)
    return null
  }
}

/**
 * Get RAG configuration for an agent
 */
export async function getAgentRAGConfig(agentId: string): Promise<{
  enabled: boolean
  chunkCount: number
  similarityThreshold: number
} | null> {
  const supabase = getServiceSupabaseClient()

  const { data: agent, error } = await supabase
    .from('vibe_agents')
    .select('rag_enabled, rag_chunk_count, rag_similarity_threshold')
    .eq('id', agentId)
    .maybeSingle()

  if (error || !agent) {
    console.error('[RAG] Failed to get agent RAG config:', error)
    return null
  }

  return {
    enabled: agent.rag_enabled ?? true,
    chunkCount: agent.rag_chunk_count ?? 5,
    similarityThreshold: agent.rag_similarity_threshold ?? 0.7
  }
}

/**
 * Format RAG context for LLM prompt
 *
 * @param ragContext - Retrieved RAG context
 * @returns Formatted string to inject into system prompt
 */
export function formatRAGPrompt(ragContext: RAGContext): string {
  if (!ragContext.context || ragContext.chunks.length === 0) {
    return ''
  }

  const prompt = `
You have access to the following knowledge base documents:

${ragContext.context}

Use the information from these sources to answer the user's question accurately. If the information is not in the provided documents, you can still use your general knowledge but make it clear what came from the documents vs. your general knowledge.

When citing information from the documents, mention the source (e.g., "According to [Source 1: filename.pdf]...").
`.trim()

  return prompt
}

/**
 * Extract source citations from chunks for response attribution
 */
export function formatSourceCitations(ragContext: RAGContext): string {
  if (ragContext.sources.length === 0) {
    return ''
  }

  const citations = ragContext.sources.map((source, i) => `${i + 1}. ${source}`)

  return `\n\n**Sources:**\n${citations.join('\n')}`
}
