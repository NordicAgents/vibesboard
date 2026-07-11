import { v4 as uuid } from 'uuid'
import type { HybridStore, MemoryFilter, MutationFilter } from '../interfaces/store.ts'
import type {
  HybridMemory,
  Observation,
  ObservationStatus,
  PendingMutation,
  ConversationRef,
  MessageChunk,
  EngineContext,
  MutationStatus,
} from '../types.ts'

/**
 * InMemoryHybridStore — zero-config store for tests and prototyping.
 * Not for production. No persistence, no real vector search (uses dot product).
 */
export class InMemoryHybridStore implements HybridStore {
  private memories = new Map<string, HybridMemory>()
  private observations = new Map<string, Observation>()
  private mutations = new Map<string, PendingMutation>()
  private messageEmbeddings = new Map<string, { embedding: number[]; content: string; ctx: EngineContext }>()
  private processedConversations = new Set<string>()

  // ── Memories ────────────────────────────────────────────────────────────────

  async saveMemory(memory: HybridMemory): Promise<void> {
    this.memories.set(memory.id, memory)
  }

  async getMemory(id: string): Promise<HybridMemory | null> {
    return this.memories.get(id) ?? null
  }

  async listMemories(filter: MemoryFilter): Promise<HybridMemory[]> {
    return [...this.memories.values()].filter(m => matchesMemoryFilter(m, filter))
  }

  async updateMemory(id: string, patch: Partial<HybridMemory>): Promise<HybridMemory> {
    const existing = this.memories.get(id)
    if (!existing) throw new Error(`Memory ${id} not found`)
    const updated = { ...existing, ...patch, version: existing.version + 1 }
    this.memories.set(id, updated)
    return updated
  }

  async deleteMemory(id: string): Promise<void> {
    this.memories.delete(id)
  }

  async searchMemories(embedding: number[], k: number, filter: MemoryFilter): Promise<HybridMemory[]> {
    const candidates = [...this.memories.values()]
      .filter(m => matchesMemoryFilter(m, filter) && m.embedding)
      .map(m => ({ m, score: dotProduct(embedding, m.embedding!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
    return candidates.map(c => c.m)
  }

  // ── Observations ────────────────────────────────────────────────────────────

  async saveObservation(obs: Observation): Promise<void> {
    this.observations.set(obs.id, obs)
  }

  async updateObservationStatus(id: string, status: ObservationStatus): Promise<void> {
    const obs = this.observations.get(id)
    if (obs) this.observations.set(id, { ...obs, status })
  }

  async searchObservations(embedding: number[], k: number, scopeId: string): Promise<Observation[]> {
    return [...this.observations.values()]
      .filter(o => o.scopeId === scopeId && o.statementEmbedding)
      .map(o => ({ o, score: dotProduct(embedding, o.statementEmbedding!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(x => x.o)
  }

  async getPendingObservations(scopeId?: string, limit = 50): Promise<Observation[]> {
    return [...this.observations.values()]
      .filter(o => (o.status === 'new' || o.status === 'deferred') && (!scopeId || o.scopeId === scopeId))
      .slice(0, limit)
  }

  async getIdleConversations(cooldownMs: number, scopeId?: string): Promise<ConversationRef[]> {
    const cutoff = new Date(Date.now() - cooldownMs)
    const seen = new Map<string, ConversationRef>()

    for (const [, entry] of this.messageEmbeddings) {
      const cid = entry.ctx.conversationId
      if (this.processedConversations.has(cid)) continue
      if (scopeId && entry.ctx.scopeId !== scopeId) continue
      if (!seen.has(cid)) {
        seen.set(cid, {
          conversationId: cid,
          scopeId: entry.ctx.scopeId,
          subScopeId: entry.ctx.subScopeId ?? null,
          lastActivityAt: cutoff, // simplified — real impl tracks last message time
        })
      }
    }
    return [...seen.values()]
  }

  async markConversationProcessed(conversationId: string): Promise<void> {
    this.processedConversations.add(conversationId)
  }

  // ── Message embeddings ───────────────────────────────────────────────────────

  async saveMessageEmbedding(messageId: string, embedding: number[], ctx: EngineContext): Promise<void> {
    this.messageEmbeddings.set(messageId, { embedding, content: messageId, ctx })
  }

  async searchMessages(embedding: number[], k: number, ctx: EngineContext): Promise<MessageChunk[]> {
    return [...this.messageEmbeddings.entries()]
      .filter(([, e]) => e.ctx.conversationId === ctx.conversationId || e.ctx.scopeId === ctx.scopeId)
      .map(([id, e]) => ({ messageId: id, content: e.content, conversationId: e.ctx.conversationId, similarity: dotProduct(embedding, e.embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  async saveMutation(mutation: PendingMutation): Promise<void> {
    this.mutations.set(mutation.id, mutation)
  }

  async getMutation(id: string): Promise<PendingMutation | null> {
    return this.mutations.get(id) ?? null
  }

  async listMutations(filter: MutationFilter): Promise<PendingMutation[]> {
    return [...this.mutations.values()].filter(m => matchesMutationFilter(m, filter))
  }

  async updateMutationStatus(id: string, status: MutationStatus, resolvedAt: Date): Promise<void> {
    const mut = this.mutations.get(id)
    if (mut) this.mutations.set(id, { ...mut, status, resolvedAt })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
}

function matchesMemoryFilter(m: HybridMemory, f: MemoryFilter): boolean {
  if (f.scopeId && m.scopeId !== f.scopeId) return false
  if (f.subScopeId !== undefined && m.subScopeId !== f.subScopeId) return false
  if (f.presenceClass && m.presenceClass !== f.presenceClass) return false
  if (f.scope && m.scope !== f.scope) return false
  if (f.minImportance != null && m.importance < f.minImportance) return false
  return true
}

function matchesMutationFilter(m: PendingMutation, f: MutationFilter): boolean {
  if (f.scopeId && m.scopeId !== f.scopeId) return false
  if (f.status && m.status !== f.status) return false
  if (f.approver && m.approver !== f.approver) return false
  return true
}
