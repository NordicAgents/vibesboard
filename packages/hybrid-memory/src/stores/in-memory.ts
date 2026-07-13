import { randomUUID as uuid } from 'node:crypto'
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
  private messageEmbeddings = new Map<string, { embedding: number[]; content: string; ctx: EngineContext; createdAt: Date }>()
  private processedConversations = new Set<string>()

  // ── Memories ────────────────────────────────────────────────────────────────

  async saveMemory(memory: HybridMemory): Promise<void> {
    this.memories.set(memory.id, memory)
  }

  async getMemory(id: string): Promise<HybridMemory | null> {
    return this.memories.get(id) ?? null
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
    return [...this.memories.values()]
      .filter(m => matchesMemoryFilter(m, filter) && m.embedding)
      .map(m => ({ m, score: dotProduct(embedding, m.embedding!) }))
      .sort((a, b) => b.score - a.score)   // descending — most similar first
      .slice(0, k)
      .map(c => c.m)
  }

  async listMemories(filter: MemoryFilter): Promise<HybridMemory[]> {
    return [...this.memories.values()]
      .filter(m => matchesMemoryFilter(m, filter))
      .sort((a, b) => b.importance - a.importance)  // descending — most important first
  }

  // ── Observations ────────────────────────────────────────────────────────────

  async saveObservation(obs: Observation): Promise<void> {
    this.observations.set(obs.id, obs)
  }

  async updateObservationStatus(id: string, status: ObservationStatus): Promise<void> {
    const obs = this.observations.get(id)
    if (obs) this.observations.set(id, { ...obs, status })
  }

  async searchObservations(embedding: number[], k: number, scopeId: string, subScopeId?: string | null): Promise<Observation[]> {
    return [...this.observations.values()]
      .filter(o => o.scopeId === scopeId && (typeof subScopeId === 'string' ? o.subScopeId === subScopeId : (o.subScopeId === null || o.subScopeId === undefined)) && o.statementEmbedding && (o.status === 'new' || o.status === 'deferred'))
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
    const latest = new Map<string, { ref: ConversationRef; lastAt: Date }>()

    for (const [, entry] of this.messageEmbeddings) {
      const cid = entry.ctx.conversationId
      if (this.processedConversations.has(cid)) continue
      if (scopeId && entry.ctx.scopeId !== scopeId) continue
      const existing = latest.get(cid)
      if (!existing || entry.createdAt > existing.lastAt) {
        latest.set(cid, {
          lastAt: entry.createdAt,
          ref: { conversationId: cid, scopeId: entry.ctx.scopeId, subScopeId: entry.ctx.subScopeId ?? null, lastActivityAt: entry.createdAt },
        })
      }
    }
    return [...latest.values()]
      .filter(({ lastAt }) => lastAt < cutoff)
      .map(({ ref }) => ref)
  }

  async markConversationProcessed(conversationId: string): Promise<void> {
    this.processedConversations.add(conversationId)
  }

  // ── Message embeddings ───────────────────────────────────────────────────────

  async saveMessageEmbedding(messageId: string, content: string, embedding: number[], ctx: EngineContext): Promise<void> {
    this.messageEmbeddings.set(messageId, { embedding, content, ctx, createdAt: new Date() })
  }

  async listMessagesByConversation(conversationId: string): Promise<MessageChunk[]> {
    return [...this.messageEmbeddings.entries()]
      .filter(([, e]) => e.ctx.conversationId === conversationId)
      .map(([id, e]) => ({ messageId: id, content: e.content, conversationId, similarity: 1 }))
  }

  async searchMessages(embedding: number[], k: number, ctx: EngineContext): Promise<MessageChunk[]> {
    return [...this.messageEmbeddings.entries()]
      .filter(([, e]) => e.ctx.scopeId === ctx.scopeId && e.embedding && (ctx.subScopeId ? e.ctx.subScopeId === ctx.subScopeId : !e.ctx.subScopeId))
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
  if (f.includeOrgWide && f.subScopeId != null) {
    if (m.subScopeId !== null && m.subScopeId !== f.subScopeId) return false
  } else if (f.subScopeId !== undefined && m.subScopeId !== f.subScopeId) return false
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
