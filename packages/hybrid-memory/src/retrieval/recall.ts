import type { Embedder } from '../interfaces/embedder.ts'
import type { HybridStore, MemoryFilter } from '../interfaces/store.ts'
import type { HybridMemory, RecallResult, EngineContext } from '../types.ts'
import { serializeTreeToC } from '../serializer.ts'

export interface RecallOptions {
  embedder: Embedder
  store: HybridStore
  defaultK: number
  maxOmnipresentTokens: number
}

/**
 * Hybrid recall — all three presence classes in one pass.
 *
 * 1. Omnipresent: always loaded, no search needed
 * 2. Pattern: loaded when trigger terms appear in the query
 * 3. Searched: vector similarity from remaining 'on-demand' memories,
 *    delegated to the store (mirrors simple-engram's recall)
 */
export async function recall(
  query: string,
  ctx: EngineContext,
  opts: RecallOptions,
): Promise<RecallResult> {
  const baseFilter: MemoryFilter = {
    scopeId: ctx.scopeId,
    subScopeId: ctx.subScopeId ?? null,
  }

  const [omnipresent, allPatternMemories, queryEmbedding] = await Promise.all([
    opts.store.listMemories({ ...baseFilter, presenceClass: 'omnipresent' }),
    opts.store.listMemories({ ...baseFilter, presenceClass: 'pattern' }),
    opts.embedder.embed(query),
  ])

  // Pattern-triggered: check if any trigger term appears in the query (case-insensitive)
  const lowerQuery = query.toLowerCase()
  const pattern = allPatternMemories.filter(m =>
    m.triggerPatterns?.some(t => lowerQuery.includes(t.toLowerCase())),
  )

  // Vector search across 'on-demand' class
  const searched = await opts.store.searchMemories(queryEmbedding, opts.defaultK, {
    ...baseFilter,
    presenceClass: 'on-demand',
  })

  const contextBlock = serializeTreeToC(
    [...omnipresent, ...pattern, ...searched],
    { maxOmnipresentTokens: opts.maxOmnipresentTokens },
  )

  return { omnipresent, pattern, searched, contextBlock }
}
