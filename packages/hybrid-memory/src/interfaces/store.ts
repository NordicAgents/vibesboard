import type {
  HybridMemory,
  NewHybridMemory,
  Observation,
  NewObservation,
  ObservationStatus,
  PendingMutation,
  MemoryMutation,
  MutationStatus,
  MutationApprover,
  ConversationRef,
  MessageChunk,
  EngineContext,
} from '../types.ts'

/**
 * HybridStore — the single interface any storage backend must implement.
 *
 * Extend this for Postgres+pgvector, Pinecone, SQLite, or anything else.
 * The engine never touches a database directly.
 */
export interface HybridStore {
  // ── Memories ──────────────────────────────────────────────────────────────

  saveMemory(memory: HybridMemory): Promise<void>
  getMemory(id: string): Promise<HybridMemory | null>
  listMemories(filter: MemoryFilter): Promise<HybridMemory[]>
  updateMemory(id: string, patch: Partial<HybridMemory>): Promise<HybridMemory>
  deleteMemory(id: string): Promise<void>

  /** Vector similarity search — returns top-k ordered by similarity */
  searchMemories(embedding: number[], k: number, filter: MemoryFilter): Promise<HybridMemory[]>

  // ── Observations ──────────────────────────────────────────────────────────

  saveObservation(obs: Observation): Promise<void>
  updateObservationStatus(id: string, status: ObservationStatus): Promise<void>

  /** Find sibling observations by statement embedding (cross-conversation) */
  searchObservations(embedding: number[], k: number, scopeId: string): Promise<Observation[]>

  /** Fetch new/deferred observations ready for reconciliation */
  getPendingObservations(scopeId?: string, limit?: number): Promise<Observation[]>

  /** Find conversations that have been idle longer than cooldownMs */
  getIdleConversations(cooldownMs: number, scopeId?: string): Promise<ConversationRef[]>

  /** Mark a conversation as having observations extracted */
  markConversationProcessed(conversationId: string): Promise<void>

  // ── Indiscriminate capture (message embeddings) ───────────────────────────

  saveMessageEmbedding(messageId: string, embedding: number[], ctx: EngineContext): Promise<void>
  searchMessages(embedding: number[], k: number, ctx: EngineContext): Promise<MessageChunk[]>

  // ── Mutations (approval queue) ────────────────────────────────────────────

  saveMutation(mutation: PendingMutation): Promise<void>
  getMutation(id: string): Promise<PendingMutation | null>
  listMutations(filter: MutationFilter): Promise<PendingMutation[]>
  updateMutationStatus(id: string, status: MutationStatus, resolvedAt: Date): Promise<void>
}

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface MemoryFilter {
  scopeId?: string
  subScopeId?: string | null
  presenceClass?: HybridMemory['presenceClass']
  scope?: HybridMemory['scope']
  minImportance?: number
  namespace?: string
}

export interface MutationFilter {
  scopeId?: string
  status?: MutationStatus
  approver?: MutationApprover
}
