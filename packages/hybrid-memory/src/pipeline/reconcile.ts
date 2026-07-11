import { v4 as uuid } from 'uuid'
import type { LLMProvider } from '../interfaces/llm.ts'
import type { HybridStore } from '../interfaces/store.ts'
import type { Observation, PendingMutation, MemoryMutation, HybridMemory, NewHybridMemory } from '../types.ts'
import { reconciliationPrompt } from '../prompts.ts'
import { serializeTreeToC } from '../serializer.ts'

export interface ReconcileOptions {
  llm: LLMProvider
  store: HybridStore
  observationNeighbors: number
  messageNeighbors: number
  autoApprove: boolean
}

/**
 * Stage 2 — Observation Reconciliation.
 * Cross-conversation awareness: for each pending observation, gather sibling
 * observations + message chunks + existing memory context, then let the LLM
 * decide whether to mutate, defer, or discard.
 */
export async function runReconciliation(
  opts: ReconcileOptions,
): Promise<{ processed: number; mutated: number; deferred: number; discarded: number }> {
  const pending = await opts.store.getPendingObservations(undefined, 50)
  let mutated = 0, deferred = 0, discarded = 0

  for (const obs of pending) {
    try {
      const result = await reconcileObservation(obs, opts)
      if (result === 'mutate') mutated++
      else if (result === 'defer') deferred++
      else discarded++
    } catch {
      // leave status as-is so it retries next run
    }
  }

  return { processed: pending.length, mutated, deferred, discarded }
}

async function reconcileObservation(
  obs: Observation,
  opts: ReconcileOptions,
): Promise<'mutate' | 'defer' | 'discard'> {
  const [siblings, messages, existingMemories] = await Promise.all([
    obs.statementEmbedding
      ? opts.store.searchObservations(obs.statementEmbedding, opts.observationNeighbors, obs.scopeId)
      : Promise.resolve([] as Observation[]),
    obs.evidenceEmbedding
      ? opts.store.searchMessages(obs.evidenceEmbedding, opts.messageNeighbors, {
          conversationId: obs.conversationId,
          scopeId: obs.scopeId,
          subScopeId: obs.subScopeId,
        })
      : Promise.resolve([]),
    opts.store.listMemories({ scopeId: obs.scopeId, subScopeId: obs.subScopeId }),
  ])

  const siblingTexts = siblings
    .filter(s => s.id !== obs.id)
    .map(s => `${s.statement} (from conv ${s.conversationId})`)

  const messageTexts = messages.map(m => m.content)

  const toc = serializeTreeToC(existingMemories, { tocOnly: true })

  const omnipresent = existingMemories
    .filter(m => m.presenceClass === 'omnipresent')
    .map(m => `[${m.key}] ${m.content}`)
    .join('\n')

  const raw = await opts.llm.complete(
    reconciliationPrompt({
      observation: `Statement: ${obs.statement}\nEvidence: ${obs.evidence}`,
      siblingObservations: siblingTexts,
      relevantMessages: messageTexts,
      existingMemoryToc: toc,
      existingMemoryExcerpts: omnipresent,
    }),
    { maxTokens: 1024, temperature: 0.1 },
  )

  let parsed: {
    decision: 'mutate' | 'defer' | 'discard'
    reasoning: string
    mutations?: Array<{
      operation: 'add' | 'modify' | 'delete'
      key?: string
      description?: string
      content?: string
      presenceClass?: HybridMemory['presenceClass']
      triggerPatterns?: string[]
      memoryId?: string
    }>
  }

  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    await opts.store.updateObservationStatus(obs.id, 'discarded')
    return 'discard'
  }

  if (parsed.decision === 'defer') {
    await opts.store.updateObservationStatus(obs.id, 'deferred')
    return 'defer'
  }

  if (parsed.decision === 'discard') {
    await opts.store.updateObservationStatus(obs.id, 'discarded')
    return 'discard'
  }

  // Build mutations
  const mutations: MemoryMutation[] = (parsed.mutations ?? []).map(m => {
    if (m.operation === 'add') {
      const memory: NewHybridMemory = {
        content: m.content ?? '',
        category: 'preference',
        importance: 0.7,
        surprise: 0,
        embedding: undefined,
        key: m.key ?? '/misc/unknown',
        description: m.description ?? '',
        presenceClass: m.presenceClass ?? 'pattern',
        triggerPatterns: m.triggerPatterns ?? [],
        scope: obs.subScopeId ? 'member' : 'org',
        scopeId: obs.scopeId,
        subScopeId: obs.subScopeId ?? null,
      }
      return { operation: 'add', memory }
    }
    if (m.operation === 'modify') {
      return {
        operation: 'modify',
        memoryId: m.memoryId ?? '',
        patch: {
          content: m.content,
          key: m.key,
          description: m.description,
          presenceClass: m.presenceClass,
          triggerPatterns: m.triggerPatterns,
        },
      }
    }
    return { operation: 'delete', memoryId: m.memoryId ?? '' }
  })

  const approver = obs.subScopeId ? 'member' : 'org-admin'

  for (const mutation of mutations) {
    const pending: PendingMutation = {
      id: uuid(),
      scopeId: obs.scopeId,
      subScopeId: obs.subScopeId ?? null,
      mutation,
      approver,
      status: opts.autoApprove ? 'approved' : 'pending',
      sourceObservationIds: [obs.id],
      createdAt: new Date(),
    }
    await opts.store.saveMutation(pending)

    if (opts.autoApprove) {
      await applyMutation(mutation, opts.store)
    }
  }

  await opts.store.updateObservationStatus(obs.id, 'consolidated')
  return 'mutate'
}

export async function applyMutation(mutation: MemoryMutation, store: HybridStore): Promise<void> {
  if (mutation.operation === 'add') {
    const memory: HybridMemory = {
      id: uuid(),
      ...mutation.memory,
      version: 1,
      accessCount: 0,
      lastAccessed: new Date(),
      createdAt: new Date(),
    }
    await store.saveMemory(memory)
  } else if (mutation.operation === 'modify') {
    await store.updateMemory(mutation.memoryId, mutation.patch)
  } else {
    await store.deleteMemory(mutation.memoryId)
  }
}
