import { type Message } from '@vibesboard/contracts'
import { and, eq, desc, sql, inArray, isNull, isNotNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  conversations as conversationsTable,
  messages as messagesTable,
  conversationFeedback as conversationFeedbackTable,
  embeddings as embeddingsTable
} from '@vibesboard/adapter-postgres/schema'
import { rowToConversation } from './db.ts'
import { type VibeAgentConversation } from '@vibesboard/contracts'
import { isUuid } from '@vibesboard/utils'

type Db = PostgresJsDatabase<typeof schema>

/** Load a conversation row + its ordered messages + latest feedback, mapped. */
async function loadConversation(
  db: Db,
  tenantId: string,
  agentId: string | null,
  id: string
): Promise<VibeAgentConversation | null> {
  const [row] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.id, id)
      )
    )
    .limit(1)
  if (!row) return null
  if (agentId && row.agentId !== agentId) return null
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const [fb] = await db
    .select()
    .from(conversationFeedbackTable)
    .where(eq(conversationFeedbackTable.conversationId, id))
    .orderBy(desc(conversationFeedbackTable.createdAt))
    .limit(1)
  return rowToConversation(row, msgs, fb ?? null)
}

async function insertMessages(
  db: Db,
  tenantId: string,
  conversationId: string,
  messages: Message[]
) {
  if (!messages.length) return
  await db.insert(messagesTable).values(
    messages.map((m) => ({
      id: isUuid(m.id) ? m.id : uuidv7(),
      tenantId,
      conversationId,
      // Persist only user/assistant turns. A fabricated system/tool role must
      // not be written to the stored transcript (which later re-feeds the
      // model, summaries, and memory), so coerce anything else to 'user'.
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content ?? '')
    }))
  )
}

interface ConversationIdentifier {
  conversationId?: string
  userId?: string | null
  externalId?: string | null
}

interface EnsureConversationArgs extends ConversationIdentifier {
  tenantId: string
  agentId: string
  initialMessages?: Message[]
}

export async function ensureConversation(
  {
    tenantId,
    agentId,
    conversationId,
    userId,
    externalId,
    initialMessages = []
  }: EnsureConversationArgs,
  db: Db = getMigrateDb()
): Promise<VibeAgentConversation> {
  if (conversationId) {
    const existing = await loadConversation(db, tenantId, null, conversationId)
    if (existing) {
      if (existing.agentId !== agentId) {
        throw new Error('Conversation does not belong to agent')
      }
      if (userId && existing.userId && existing.userId !== userId) {
        throw new Error('Unauthorized conversation access')
      }
      if (externalId && existing.externalId && existing.externalId !== externalId) {
        throw new Error('Unauthorized conversation access')
      }
      return existing
    }
  }

  if (!conversationId && externalId) {
    const [row] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.agentId, agentId),
          eq(conversationsTable.externalId, externalId)
        )
      )
      .limit(1)
    if (row) return (await loadConversation(db, tenantId, agentId, row.id))!
  }

  const id = conversationId && isUuid(conversationId) ? conversationId : uuidv7()
  return db.transaction(async (tx) => {
    await tx.insert(conversationsTable).values({
      id,
      tenantId,
      agentId,
      userId: userId ?? null,
      externalId: externalId ?? null
    })
    await insertMessages(tx as unknown as Db, tenantId, id, initialMessages)
    return (await loadConversation(tx as unknown as Db, tenantId, agentId, id))!
  })
}

interface UpdateConversationArgs {
  tenantId: string
  agentId: string
  conversationId: string
  messages: Message[]
  summary?: string | null
  respondingAgentId?: string
}

export async function updateConversationMessages(
  {
    tenantId,
    agentId,
    conversationId,
    messages,
    summary,
    respondingAgentId
  }: UpdateConversationArgs,
  db: Db = getMigrateDb()
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
    await insertMessages(tx as unknown as Db, tenantId, conversationId, messages)

    const patch: Partial<typeof conversationsTable.$inferInsert> = {
      updatedAt: new Date()
    }
    if (summary !== undefined) patch.summary = summary
    await tx
      .update(conversationsTable)
      .set(patch)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.id, conversationId)
        )
      )

    if (respondingAgentId) {
      // Increment responseCounts[respondingAgentId] in jsonb atomically.
      await tx
        .update(conversationsTable)
        .set({
          responseCounts: sql`jsonb_set(
            coalesce(${conversationsTable.responseCounts}, '{}'::jsonb),
            ${`{${respondingAgentId}}`}::text[],
            to_jsonb(coalesce((${conversationsTable.responseCounts} ->> ${respondingAgentId})::int, 0) + 1)
          )`
        })
        .where(
          and(
            eq(conversationsTable.tenantId, tenantId),
            eq(conversationsTable.id, conversationId)
          )
        )
    }
  })
}

export async function listAgentConversations(
  tenantId: string,
  agentId: string,
  filter?: {
    userId?: string
    externalId?: string
  },
  db: Db = getMigrateDb()
): Promise<VibeAgentConversation[]> {
  const conds = [
    eq(conversationsTable.tenantId, tenantId),
    eq(conversationsTable.agentId, agentId)
  ]
  if (filter?.userId) conds.push(eq(conversationsTable.userId, filter.userId))
  if (filter?.externalId)
    conds.push(eq(conversationsTable.externalId, filter.externalId))
  const rows = await db
    .select()
    .from(conversationsTable)
    .where(and(...conds))
    .orderBy(desc(conversationsTable.updatedAt))
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(inArray(messagesTable.conversationId, ids))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) {
    const arr = byConv.get(m.conversationId) ?? []
    arr.push(m)
    byConv.set(m.conversationId, arr)
  }
  return rows.map((r) => rowToConversation(r, byConv.get(r.id) ?? [], null))
}

export async function getConversation(
  tenantId: string,
  agentId: string,
  id: string,
  db: Db = getMigrateDb()
): Promise<VibeAgentConversation | null> {
  return loadConversation(db, tenantId, agentId, id)
}

/**
 * Check whether a conversation (by externalId) has been handed off to a human.
 */
export async function isConversationHandedOff(
  tenantId: string,
  agentId: string,
  externalId: string,
  db: Db = getMigrateDb()
): Promise<boolean> {
  const [row] = await db
    .select({ handedOff: conversationsTable.handedOff })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.agentId, agentId),
        eq(conversationsTable.externalId, externalId)
      )
    )
    .limit(1)
  return row?.handedOff === true
}

/**
 * Mark a conversation as handed off to a human agent.
 */
export async function markConversationHandedOff(
  tenantId: string,
  agentId: string,
  conversationId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(conversationsTable)
    .set({ handedOff: true, updatedAt: new Date() })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.id, conversationId)
      )
    )
}

/**
 * Resume a conversation that was previously handed off to a human agent.
 */
export async function resumeConversation(
  tenantId: string,
  agentId: string,
  conversationId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .update(conversationsTable)
    .set({ handedOff: false, updatedAt: new Date() })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.id, conversationId)
      )
    )
}

/**
 * Record an agent-to-agent handoff on a conversation.
 * Appends to the handoffChain jsonb array and sets the active agent so the
 * target agent's derived handoff refs surface the conversation.
 */
export async function recordConversationHandoff(
  tenantId: string,
  agentId: string,
  conversationId: string,
  handoff: {
    fromAgentId: string
    fromAgentName: string
    toAgentId: string
    toAgentName: string
  },
  db: Db = getMigrateDb()
): Promise<void> {
  const entry = { ...handoff, timestamp: new Date().toISOString() }
  await db
    .update(conversationsTable)
    .set({
      handoffChain: sql`coalesce(${conversationsTable.handoffChain}, '[]'::jsonb) || ${JSON.stringify(
        [entry]
      )}::jsonb`,
      activeAgentId: handoff.toAgentId,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.id, conversationId)
      )
    )
}

/**
 * DERIVED refs: conversations whose handoffChain targets this agent.
 * Replaces the legacy per-agent conversation_refs collection.
 */
export async function listHandoffConversationsForAgent(
  tenantId: string,
  agentId: string,
  db: Db = getMigrateDb(),
  limit = 10
): Promise<VibeAgentConversation[]> {
  const rows = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        sql`${conversationsTable.handoffChain} @> ${JSON.stringify([
          { toAgentId: agentId }
        ])}::jsonb`
      )
    )
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(inArray(messagesTable.conversationId, ids))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) {
    const arr = byConv.get(m.conversationId) ?? []
    arr.push(m)
    byConv.set(m.conversationId, arr)
  }
  return rows.map((r) => rowToConversation(r, byConv.get(r.id) ?? [], null))
}

/**
 * Delete a conversation and its associated data.
 * Messages and feedback FK-cascade on the conversation delete; conversation
 * embeddings are not FK-linked, so remove them explicitly.
 */
export async function deleteConversation(
  tenantId: string,
  agentId: string,
  conversationId: string,
  db: Db = getMigrateDb()
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.agentId, agentId),
          eq(conversationsTable.id, conversationId)
        )
      )
      .limit(1)
    if (!row) return false
    await tx
      .delete(embeddingsTable)
      .where(
        and(
          eq(embeddingsTable.tenantId, tenantId),
          eq(embeddingsTable.sourceType, 'conversation_chunk'),
          eq(embeddingsTable.sourceId, conversationId)
        )
      )
    // Cascades messages + feedback.
    await tx
      .delete(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
    return true
  })
}

/**
 * Record a single feedback submission for a conversation. The latest row
 * (by created_at) is surfaced via rowToConversation.
 */
export async function recordConversationFeedback(
  tenantId: string,
  conversationId: string,
  feedback: { rating: 'positive' | 'negative'; comment?: string },
  db: Db = getMigrateDb()
): Promise<void> {
  await db.insert(conversationFeedbackTable).values({
    id: uuidv7(),
    tenantId,
    conversationId,
    rating: feedback.rating,
    comment: feedback.comment?.slice(0, 500) ?? null
  })
}

/**
 * Close a conversation, optionally persisting a final summary.
 */
export async function closeConversation(
  tenantId: string,
  agentId: string,
  conversationId: string,
  summary: string | null,
  db: Db = getMigrateDb()
): Promise<boolean> {
  const now = new Date()
  const res = await db
    .update(conversationsTable)
    .set({
      closedAt: now,
      updatedAt: now,
      ...(summary != null ? { summary, summaryGeneratedAt: now } : {})
    })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.agentId, agentId),
        eq(conversationsTable.id, conversationId)
      )
    )
    .returning({ id: conversationsTable.id })
  return res.length > 0
}

/**
 * Persist a summary for a conversation without closing it (used by the
 * refresh-summaries route).
 */
export async function updateConversationSummary(
  tenantId: string,
  agentId: string,
  conversationId: string,
  summary: string,
  db: Db = getMigrateDb()
): Promise<void> {
  const now = new Date()
  await db
    .update(conversationsTable)
    .set({ summary, summaryGeneratedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.agentId, agentId),
        eq(conversationsTable.id, conversationId)
      )
    )
}

/**
 * List visitor conversations (externalId set, no owner user) that have not
 * been summarized yet, newest first.
 */
export async function listUnsummarizedVisitorConversations(
  tenantId: string,
  agentId: string,
  limit: number,
  db: Db = getMigrateDb()
): Promise<VibeAgentConversation[]> {
  const rows = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.agentId, agentId),
        isNotNull(conversationsTable.externalId),
        isNull(conversationsTable.userId),
        isNull(conversationsTable.summary)
      )
    )
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(inArray(messagesTable.conversationId, ids))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) {
    const arr = byConv.get(m.conversationId) ?? []
    arr.push(m)
    byConv.set(m.conversationId, arr)
  }
  return rows.map((r) => rowToConversation(r, byConv.get(r.id) ?? [], null))
}

/**
 * Load a conversation by id without an agent filter (cross-agent lookup used
 * by the conversation-detail page's handoff fallback).
 */
export async function getConversationAnyAgent(
  tenantId: string,
  conversationId: string,
  db: Db = getMigrateDb()
): Promise<VibeAgentConversation | null> {
  return loadConversation(db, tenantId, null, conversationId)
}
