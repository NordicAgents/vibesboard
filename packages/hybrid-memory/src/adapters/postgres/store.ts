import { eq, and, sql, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { HybridStore, MemoryFilter, MutationFilter } from '../../interfaces/store.ts'
import type {
  HybridMemory,
  Observation,
  ObservationStatus,
  PendingMutation,
  ConversationRef,
  MessageChunk,
  EngineContext,
  MutationStatus,
} from '../../types.ts'
import {
  hybridMemories,
  hybridObservations,
  hybridMessageEmbeddings,
  hybridProcessedConversations,
  hybridMutations,
} from './schema.ts'

type AnyDb = PostgresJsDatabase<any>

/**
 * PostgresHybridStore — production-ready HybridStore backed by Postgres + pgvector.
 *
 * Pass any Drizzle postgres-js client (the migrate/bypass-RLS client is
 * recommended since memory operations are infrastructure-level, cross-scope).
 */
export class PostgresHybridStore implements HybridStore {
  constructor(private db: AnyDb) {}

  // ── Memories ────────────────────────────────────────────────────────────────

  async saveMemory(memory: HybridMemory): Promise<void> {
    await this.db
      .insert(hybridMemories)
      .values(toMemoryRow(memory))
      .onConflictDoUpdate({
        target: hybridMemories.id,
        set: { ...toMemoryRow(memory), updatedAt: new Date() },
      })
  }

  async getMemory(id: string): Promise<HybridMemory | null> {
    const rows = await this.db
      .select()
      .from(hybridMemories)
      .where(eq(hybridMemories.id, id))
      .limit(1)
    return rows[0] ? fromMemoryRow(rows[0]) : null
  }

  async listMemories(filter: MemoryFilter): Promise<HybridMemory[]> {
    const conditions = buildMemoryConditions(filter)
    const rows = await this.db
      .select()
      .from(hybridMemories)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(hybridMemories.importance)
    return rows.map(fromMemoryRow)
  }

  async updateMemory(id: string, patch: Partial<HybridMemory>): Promise<HybridMemory> {
    const rows = await this.db
      .update(hybridMemories)
      .set({ ...toPartialMemoryRow(patch), updatedAt: new Date() })
      .where(eq(hybridMemories.id, id))
      .returning()
    if (!rows[0]) throw new Error(`Memory ${id} not found`)
    return fromMemoryRow(rows[0])
  }

  async deleteMemory(id: string): Promise<void> {
    await this.db.delete(hybridMemories).where(eq(hybridMemories.id, id))
  }

  async searchMemories(embedding: number[], k: number, filter: MemoryFilter): Promise<HybridMemory[]> {
    const conditions = buildMemoryConditions(filter)
    const vec = `[${embedding.join(',')}]`

    // cosine distance — lower = more similar
    const rows = await this.db
      .select()
      .from(hybridMemories)
      .where(and(
        ...conditions,
        sql`${hybridMemories.embedding} IS NOT NULL`,
      ))
      .orderBy(sql`${hybridMemories.embedding} <=> ${vec}::vector`)
      .limit(k)

    return rows.map(fromMemoryRow)
  }

  // ── Observations ────────────────────────────────────────────────────────────

  async saveObservation(obs: Observation): Promise<void> {
    await this.db.insert(hybridObservations).values({
      id: obs.id,
      conversationId: obs.conversationId,
      scopeId: obs.scopeId,
      subScopeId: obs.subScopeId ?? null,
      statement: obs.statement,
      statementEmbedding: obs.statementEmbedding ?? null,
      evidenceEmbedding: obs.evidenceEmbedding ?? null,
      evidence: obs.evidence,
      status: obs.status,
      createdAt: obs.createdAt,
    })
  }

  async updateObservationStatus(id: string, status: ObservationStatus): Promise<void> {
    await this.db
      .update(hybridObservations)
      .set({ status })
      .where(eq(hybridObservations.id, id))
  }

  async searchObservations(embedding: number[], k: number, scopeId: string): Promise<Observation[]> {
    const vec = `[${embedding.join(',')}]`
    const rows = await this.db
      .select()
      .from(hybridObservations)
      .where(and(
        eq(hybridObservations.scopeId, scopeId),
        inArray(hybridObservations.status, ['new', 'deferred']),
        sql`${hybridObservations.statementEmbedding} IS NOT NULL`,
      ))
      .orderBy(sql`${hybridObservations.statementEmbedding} <=> ${vec}::vector`)
      .limit(k)
    return rows.map(fromObsRow)
  }

  async getPendingObservations(scopeId?: string, limit = 50): Promise<Observation[]> {
    const conditions = [
      inArray(hybridObservations.status, ['new', 'deferred']),
      ...(scopeId ? [eq(hybridObservations.scopeId, scopeId)] : []),
    ]
    const rows = await this.db
      .select()
      .from(hybridObservations)
      .where(and(...conditions))
      .orderBy(hybridObservations.createdAt)
      .limit(limit)
    return rows.map(fromObsRow)
  }

  async getIdleConversations(cooldownMs: number, scopeId?: string): Promise<ConversationRef[]> {
    const cutoff = new Date(Date.now() - cooldownMs)
    const conditions = [
      sql`${hybridMessageEmbeddings.createdAt} < ${cutoff}`,
      sql`${hybridMessageEmbeddings.conversationId} NOT IN (
        SELECT conversation_id FROM hybrid_processed_conversations
      )`,
      ...(scopeId ? [eq(hybridMessageEmbeddings.scopeId, scopeId)] : []),
    ]

    const rows = await this.db
      .selectDistinctOn([hybridMessageEmbeddings.conversationId], {
        conversationId: hybridMessageEmbeddings.conversationId,
        scopeId: hybridMessageEmbeddings.scopeId,
        subScopeId: hybridMessageEmbeddings.subScopeId,
        lastActivityAt: sql<Date>`max(${hybridMessageEmbeddings.createdAt})`,
      })
      .from(hybridMessageEmbeddings)
      .where(and(...conditions))
      .groupBy(
        hybridMessageEmbeddings.conversationId,
        hybridMessageEmbeddings.scopeId,
        hybridMessageEmbeddings.subScopeId,
      )

    return rows.map(r => ({
      conversationId: r.conversationId,
      scopeId: r.scopeId,
      subScopeId: r.subScopeId ?? null,
      lastActivityAt: r.lastActivityAt,
    }))
  }

  async markConversationProcessed(conversationId: string): Promise<void> {
    const rows = await this.db
      .select({ scopeId: hybridMessageEmbeddings.scopeId })
      .from(hybridMessageEmbeddings)
      .where(eq(hybridMessageEmbeddings.conversationId, conversationId))
      .limit(1)
    const scopeId = rows[0]?.scopeId ?? 'unknown'
    await this.db
      .insert(hybridProcessedConversations)
      .values({ conversationId, scopeId, processedAt: new Date() })
      .onConflictDoNothing()
  }

  // ── Message embeddings ───────────────────────────────────────────────────────

  async saveMessageEmbedding(messageId: string, embedding: number[], ctx: EngineContext): Promise<void> {
    await this.db
      .insert(hybridMessageEmbeddings)
      .values({
        messageId,
        conversationId: ctx.conversationId,
        scopeId: ctx.scopeId,
        subScopeId: ctx.subScopeId ?? null,
        content: messageId, // caller can pass content separately; messageId as fallback
        embedding,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
  }

  async searchMessages(embedding: number[], k: number, ctx: EngineContext): Promise<MessageChunk[]> {
    const vec = `[${embedding.join(',')}]`
    const rows = await this.db
      .select({
        messageId: hybridMessageEmbeddings.messageId,
        content: hybridMessageEmbeddings.content,
        conversationId: hybridMessageEmbeddings.conversationId,
        similarity: sql<number>`1 - (${hybridMessageEmbeddings.embedding} <=> ${vec}::vector)`,
      })
      .from(hybridMessageEmbeddings)
      .where(and(
        eq(hybridMessageEmbeddings.scopeId, ctx.scopeId),
        sql`${hybridMessageEmbeddings.embedding} IS NOT NULL`,
      ))
      .orderBy(sql`${hybridMessageEmbeddings.embedding} <=> ${vec}::vector`)
      .limit(k)
    return rows
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  async saveMutation(mutation: PendingMutation): Promise<void> {
    await this.db.insert(hybridMutations).values({
      id: mutation.id,
      scopeId: mutation.scopeId,
      subScopeId: mutation.subScopeId ?? null,
      mutation: mutation.mutation as any,
      approver: mutation.approver,
      status: mutation.status,
      sourceObservationIds: mutation.sourceObservationIds ?? [],
      createdAt: mutation.createdAt,
      resolvedAt: mutation.resolvedAt ?? null,
    })
  }

  async getMutation(id: string): Promise<PendingMutation | null> {
    const rows = await this.db
      .select()
      .from(hybridMutations)
      .where(eq(hybridMutations.id, id))
      .limit(1)
    return rows[0] ? fromMutationRow(rows[0]) : null
  }

  async listMutations(filter: MutationFilter): Promise<PendingMutation[]> {
    const conditions = []
    if (filter.scopeId) conditions.push(eq(hybridMutations.scopeId, filter.scopeId))
    if (filter.status) conditions.push(eq(hybridMutations.status, filter.status))
    if (filter.approver) conditions.push(eq(hybridMutations.approver, filter.approver))

    const rows = await this.db
      .select()
      .from(hybridMutations)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(hybridMutations.createdAt)
    return rows.map(fromMutationRow)
  }

  async updateMutationStatus(id: string, status: MutationStatus, resolvedAt: Date): Promise<void> {
    await this.db
      .update(hybridMutations)
      .set({ status, resolvedAt })
      .where(eq(hybridMutations.id, id))
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

type MemoryRow = typeof hybridMemories.$inferSelect

function toMemoryRow(m: HybridMemory): typeof hybridMemories.$inferInsert {
  return {
    id: m.id,
    scopeId: m.scopeId,
    subScopeId: m.subScopeId ?? null,
    scope: m.scope,
    key: m.key,
    description: m.description,
    content: m.content,
    category: m.category,
    presenceClass: m.presenceClass,
    triggerPatterns: m.triggerPatterns ?? [],
    importance: m.importance,
    surprise: m.surprise,
    accessCount: m.accessCount,
    lastAccessed: m.lastAccessed,
    version: m.version,
    history: (m.history ?? []).map(h => ({ content: h.content, changedAt: h.changedAt.toISOString() })),
    embedding: m.embedding ?? null,
    metadata: m.metadata ?? {},
    expiresAt: m.expiresAt ?? null,
    createdAt: m.createdAt,
    updatedAt: new Date(),
  }
}

function toPartialMemoryRow(patch: Partial<HybridMemory>): Partial<typeof hybridMemories.$inferInsert> {
  const row: Partial<typeof hybridMemories.$inferInsert> = {}
  if (patch.content !== undefined) row.content = patch.content
  if (patch.key !== undefined) row.key = patch.key
  if (patch.description !== undefined) row.description = patch.description
  if (patch.presenceClass !== undefined) row.presenceClass = patch.presenceClass
  if (patch.triggerPatterns !== undefined) row.triggerPatterns = patch.triggerPatterns
  if (patch.importance !== undefined) row.importance = patch.importance
  if (patch.accessCount !== undefined) row.accessCount = patch.accessCount
  if (patch.lastAccessed !== undefined) row.lastAccessed = patch.lastAccessed
  if (patch.version !== undefined) row.version = patch.version
  return row
}

function fromMemoryRow(r: MemoryRow): HybridMemory {
  return {
    id: r.id,
    scopeId: r.scopeId,
    subScopeId: r.subScopeId ?? null,
    scope: r.scope as HybridMemory['scope'],
    key: r.key,
    description: r.description,
    content: r.content,
    category: r.category as HybridMemory['category'],
    presenceClass: r.presenceClass as HybridMemory['presenceClass'],
    triggerPatterns: (r.triggerPatterns as string[]) ?? [],
    importance: r.importance,
    surprise: r.surprise,
    accessCount: r.accessCount,
    lastAccessed: r.lastAccessed,
    version: r.version,
    history: ((r.history as any[]) ?? []).map((h: any) => ({ content: h.content, changedAt: new Date(h.changedAt) })),
    embedding: r.embedding ?? undefined,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    expiresAt: r.expiresAt ?? undefined,
    createdAt: r.createdAt,
  }
}

type ObsRow = typeof hybridObservations.$inferSelect

function fromObsRow(r: ObsRow): Observation {
  return {
    id: r.id,
    conversationId: r.conversationId,
    scopeId: r.scopeId,
    subScopeId: r.subScopeId ?? null,
    statement: r.statement,
    statementEmbedding: r.statementEmbedding ?? undefined,
    evidence: r.evidence,
    evidenceEmbedding: r.evidenceEmbedding ?? undefined,
    status: r.status as Observation['status'],
    createdAt: r.createdAt,
  }
}

type MutRow = typeof hybridMutations.$inferSelect

function fromMutationRow(r: MutRow): PendingMutation {
  return {
    id: r.id,
    scopeId: r.scopeId,
    subScopeId: r.subScopeId ?? null,
    mutation: r.mutation as any,
    approver: r.approver as PendingMutation['approver'],
    status: r.status as PendingMutation['status'],
    sourceObservationIds: (r.sourceObservationIds as string[]) ?? [],
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt ?? undefined,
  }
}

// ─── Filter builder ───────────────────────────────────────────────────────────

function buildMemoryConditions(filter: MemoryFilter) {
  const conditions = []
  if (filter.scopeId) conditions.push(eq(hybridMemories.scopeId, filter.scopeId))
  if (filter.subScopeId !== undefined) {
    conditions.push(
      filter.subScopeId === null
        ? sql`${hybridMemories.subScopeId} IS NULL`
        : eq(hybridMemories.subScopeId, filter.subScopeId),
    )
  }
  if (filter.presenceClass) conditions.push(eq(hybridMemories.presenceClass, filter.presenceClass))
  if (filter.scope) conditions.push(eq(hybridMemories.scope, filter.scope))
  if (filter.minImportance != null) conditions.push(sql`${hybridMemories.importance} >= ${filter.minImportance}`)
  return conditions
}
