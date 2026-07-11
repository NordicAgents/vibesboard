import { v4 as uuid } from 'uuid'
import type { LLMProvider } from '../interfaces/llm.ts'
import type { Embedder } from '../interfaces/embedder.ts'
import type { HybridStore } from '../interfaces/store.ts'
import type { Observation, EngineContext } from '../types.ts'
import { observationFormationPrompt } from '../prompts.ts'

export interface ObserveOptions {
  llm: LLMProvider
  embedder: Embedder
  store: HybridStore
  cooldownMs: number
}

/**
 * Stage 1 — Observation Formation.
 * For each idle conversation, task the LLM with extracting statement+evidence
 * pairs, embed both, and queue them for Stage 2 reconciliation.
 */
export async function runObservationFormation(
  opts: ObserveOptions,
): Promise<{ conversationId: string; extracted: number }[]> {
  const idle = await opts.store.getIdleConversations(opts.cooldownMs)
  const results: { conversationId: string; extracted: number }[] = []

  for (const conv of idle) {
    try {
      const count = await extractObservationsFromConversation(conv.conversationId, conv, opts)
      await opts.store.markConversationProcessed(conv.conversationId)
      results.push({ conversationId: conv.conversationId, extracted: count })
    } catch (err) {
      results.push({ conversationId: conv.conversationId, extracted: 0 })
    }
  }

  return results
}

async function extractObservationsFromConversation(
  conversationId: string,
  conv: { scopeId: string; subScopeId?: string | null },
  opts: ObserveOptions,
): Promise<number> {
  // Fetch conversation messages — the store knows where to find them
  const chunks = await opts.store.searchMessages(
    new Array(1536).fill(0), // dummy embedding to fetch all (store can handle this)
    100,
    { conversationId, scopeId: conv.scopeId, subScopeId: conv.subScopeId },
  )

  if (!chunks.length) return 0

  const conversation = chunks
    .map(c => c.content)
    .join('\n')

  const raw = await opts.llm.complete(observationFormationPrompt(conversation), {
    maxTokens: 1024,
    temperature: 0.2,
  })

  let parsed: Array<{ statement: string; evidence: string }> = []
  try {
    parsed = JSON.parse(raw.trim())
    if (!Array.isArray(parsed)) parsed = []
  } catch {
    return 0
  }

  const valid = parsed.filter(o => o.statement?.trim() && o.evidence?.trim())
  if (!valid.length) return 0

  // Embed statements and evidence in batch
  const texts = valid.flatMap(o => [o.statement, o.evidence])
  const embeddings = await opts.embedder.embedBatch(texts)

  for (let i = 0; i < valid.length; i++) {
    const obs: Observation = {
      id: uuid(),
      conversationId,
      scopeId: conv.scopeId,
      subScopeId: conv.subScopeId ?? null,
      statement: valid[i].statement,
      statementEmbedding: embeddings[i * 2],
      evidence: valid[i].evidence,
      evidenceEmbedding: embeddings[i * 2 + 1],
      status: 'new',
      createdAt: new Date(),
    }
    await opts.store.saveObservation(obs)
  }

  return valid.length
}
