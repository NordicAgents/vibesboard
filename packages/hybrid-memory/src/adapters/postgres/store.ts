import { eq, and, sql, inArray, desc } from 'drizzle-orm'
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
      .orderBy(desc(hybridMemories.importance))   // most important first
    return rows.map(fromMemoryRow)
  }

  async updateMemory(id: string, patch: Partial<HybridMemory>): Promise<HybridMemory> {
    const row = toPartialMemoryRow(patch)

    // Content changes bump the version and record the previous content
    // (matching InMemoryHybridStore); metadata-only patches leave both alone.
    if (patch.content !== undefined && patch.version === undefined && patch.history === undefined) {
      const existing = await this.getMemory(id)
      if (!existing) throw new Error(`Memory ${id} not found`)
      if (patch.content !== existing.content) {
        row.version = existing.version + 1
        row.history = [
          ...(existing.history ?? []),
          { content: existing.content, changedAt: new Date() },
        ].map(h => ({ content: h.content, changedAt: h.changedAt.toISOString() }))
      }
    }

    const rows = await this.db
      .update(hybridMemories)
      .set({ ...row, updatedAt: new Date() })
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
      deferCount: obs.deferCount ?? 0,
      createdAt: obs.createdAt,
    })
  }

  async updateObservationStatus(id: string, status: ObservationStatus): Promise<void> {
    await this.db
      .update(hybridObservations)
      .set(
        status === 'deferred'
          ? { status, deferCount: sql`${hybridObservations.deferCount} + 1`, deferredAt: new Date() }
          : { status },
      )
      .where(eq(hybridObservations.id, id))
  }

  async searchObservations(embedding: number[], k: number, scopeId: string, subScopeId?: string | null): Promise<Observation[]> {
    const vec = `[${embedding.join(',')}]`
    const conditions: ReturnType<typeof eq>[] = [
      eq(hybridObservations.scopeId, scopeId),
      inArray(hybridObservations.status, ['new', 'deferred']),
      sql`${hybridObservations.statementEmbedding} IS NOT NULL`,
    ]
    if (typeof subScopeId === 'string') {
      conditions.push(eq(hybridObservations.subScopeId, subScopeId))
    } else if (subScopeId === null) {
      conditions.push(sql`${hybridObservations.subScopeId} IS NULL`)
    }
    const rows = await this.db
      .select()
      .from(hybridObservations)
      .where(and(...conditions))
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
      // 'new' before 'deferred' so re-queued deferrals can't starve fresh observations
      .orderBy(
        sql`case when ${hybridObservations.status} = 'new' then 0 else 1 end`,
        hybridObservations.createdAt,
      )
      .limit(limit)
    return rows.map(fromObsRow)
  }

  async getIdleConversations(cooldownMs: number, scopeId?: string): Promise<ConversationRef[]> {
    const cutoff = new Date(Date.now() - cooldownMs)
    const conditions = [
      ...(scopeId ? [eq(hybridMessageEmbeddings.scopeId, scopeId)] : []),
      sql`${hybridMessageEmbeddings.conversationId} NOT IN (
        SELECT conversation_id FROM ${hybridProcessedConversations}
      )`,
    ]

    const rows = await this.db
      .select({
        conversationId: hybridMessageEmbeddings.conversationId,
        scopeId: hybridMessageEmbeddings.scopeId,
        subScopeId: hybridMessageEmbeddings.subScopeId,
        lastActivityAt: sql<Date>`max(${hybridMessageEmbeddings.createdAt})`,
      })
      .from(hybridMessageEmbeddings)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(
        hybridMessageEmbeddings.conversationId,
        hybridMessageEmbeddings.scopeId,
        hybridMessageEmbeddings.subScopeId,
      )
      .having(sql`max(${hybridMessageEmbeddings.createdAt}) < ${cutoff}`)

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
      .onConflictDoUpdate({
        target: hybridProcessedConversations.conversationId,
        set: { processedAt: new Date() },
      })
  }

  // ── Message embeddings ───────────────────────────────────────────────────────

  async saveMessageEmbedding(messageId: string, content: string, embedding: number[], ctx: EngineContext): Promise<void> {
    await this.db
      .insert(hybridMessageEmbeddings)
      .values({
        messageId,
        conversationId: ctx.conversationId,
        scopeId: ctx.scopeId,
        subScopeId: ctx.subScopeId ?? null,
        content,
        embedding,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
  }

  async listMessagesByConversation(conversationId: string): Promise<MessageChunk[]> {
    const rows = await this.db
      .select({
        messageId: hybridMessageEmbeddings.messageId,
        content: hybridMessageEmbeddings.content,
        conversationId: hybridMessageEmbeddings.conversationId,
      })
      .from(hybridMessageEmbeddings)
      .where(eq(hybridMessageEmbeddings.conversationId, conversationId))
      .orderBy(hybridMessageEmbeddings.createdAt)
    return rows.map(r => ({ ...r, similarity: 1 }))
  }

  async searchMessages(embedding: number[], k: number, ctx: EngineContext): Promise<MessageChunk[]> {
    const vec = `[${embedding.join(',')}]`
    const conditions = [
      eq(hybridMessageEmbeddings.scopeId, ctx.scopeId),
      sql`${hybridMessageEmbeddings.embedding} IS NOT NULL`,
    ]
    if (ctx.subScopeId) {
      conditions.push(eq(hybridMessageEmbeddings.subScopeId, ctx.subScopeId))
    } else {
      conditions.push(sql`${hybridMessageEmbeddings.subScopeId} IS NULL`)
    }
    const rows = await this.db
      .select({
        messageId: hybridMessageEmbeddings.messageId,
        content: hybridMessageEmbeddings.content,
        conversationId: hybridMessageEmbeddings.conversationId,
        similarity: sql<number>`1 - (${hybridMessageEmbeddings.embedding} <=> ${vec}::vector)`,
      })
      .from(hybridMessageEmbeddings)
      .where(and(...conditions))
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
  if (patch.surprise !== undefined) row.surprise = patch.surprise
  if (patch.accessCount !== undefined) row.accessCount = patch.accessCount
  if (patch.lastAccessed !== undefined) row.lastAccessed = patch.lastAccessed
  if (patch.version !== undefined) row.version = patch.version
  if (patch.embedding !== undefined) row.embedding = patch.embedding ?? null
  if (patch.metadata !== undefined) row.metadata = patch.metadata ?? {}
  if (patch.history !== undefined) row.history = (patch.history ?? []).map(h => ({ content: h.content, changedAt: h.changedAt.toISOString() }))
  if (patch.expiresAt !== undefined) row.expiresAt = patch.expiresAt ?? null
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
    deferCount: r.deferCount ?? 0,
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
    if (filter.subScopeId === null) {
      conditions.push(sql`${hybridMemories.subScopeId} IS NULL`)
    } else if (filter.includeOrgWide) {
      conditions.push(sql`(${hybridMemories.subScopeId} IS NULL OR ${hybridMemories.subScopeId} = ${filter.subScopeId})`)
    } else {
      conditions.push(eq(hybridMemories.subScopeId, filter.subScopeId))
    }
  }
  if (filter.presenceClass) conditions.push(eq(hybridMemories.presenceClass, filter.presenceClass))
  if (filter.scope) conditions.push(eq(hybridMemories.scope, filter.scope))
  if (filter.minImportance != null) conditions.push(sql`${hybridMemories.importance} >= ${filter.minImportance}`)
  return conditions
}
