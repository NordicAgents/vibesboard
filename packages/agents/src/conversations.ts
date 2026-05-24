import { type Message } from '@vibesboard/contracts'
import { FieldValue } from 'firebase-admin/firestore'
import { and, eq, desc, sql, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { adminDb } from '@vibesboard/adapter-firebase/admin'
import {
  Collections,
  type ConversationRefDocument
} from '@vibesboard/contracts'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  conversations as conversationsTable,
  messages as messagesTable,
  conversationFeedback as conversationFeedbackTable
} from '@vibesboard/adapter-postgres/schema'
import { rowToConversation } from './db.ts'
import { type VibeAgentConversation } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

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
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
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
  externalId: string
): Promise<boolean> {
  const collPath = Collections.conversations(tenantId, agentId)
  const snapshot = await adminDb
    .collection(collPath)
    .where('externalId', '==', externalId)
    .limit(1)
    .get()

  if (snapshot.empty) return false
  return snapshot.docs[0].data().handedOff === true
}

/**
 * Mark a conversation as handed off to a human agent.
 */
export async function markConversationHandedOff(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  const collPath = Collections.conversations(tenantId, agentId)
  await adminDb
    .collection(collPath)
    .doc(conversationId)
    .update({ handedOff: true, updatedAt: new Date().toISOString() })
}

/**
 * Resume a conversation that was previously handed off to a human agent.
 */
export async function resumeConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  const collPath = Collections.conversations(tenantId, agentId)
  await adminDb
    .collection(collPath)
    .doc(conversationId)
    .update({ handedOff: false, updatedAt: new Date().toISOString() })
}

/**
 * Record an agent-to-agent handoff on a conversation.
 * Appends to the handoffChain array and creates a conversation ref
 * in the target agent's collection for visibility.
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
  }
): Promise<void> {
  const collPath = Collections.conversations(tenantId, agentId)
  const ref = adminDb.collection(collPath).doc(conversationId)

  await ref.update({
    handoffChain: FieldValue.arrayUnion({
      ...handoff,
      timestamp: new Date().toISOString()
    }),
    updatedAt: new Date().toISOString()
  })

  // Create a conversation ref in the target agent's collection
  await createConversationRef(tenantId, handoff.toAgentId, {
    id: conversationId,
    sourceAgentId: agentId,
    sourceAgentName: handoff.fromAgentName,
    sourceConversationId: conversationId,
    role: 'active',
    responseCount: 0,
    summary: null,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  })
}

// ── Conversation ref CRUD ────────────────────────────────────────────

export async function createConversationRef(
  tenantId: string,
  targetAgentId: string,
  ref: ConversationRefDocument
): Promise<void> {
  const collPath = Collections.conversationRefs(tenantId, targetAgentId)
  await adminDb.collection(collPath).doc(ref.sourceConversationId).set(ref)
}

export async function updateConversationRef(
  tenantId: string,
  targetAgentId: string,
  conversationId: string,
  updates: Partial<
    Pick<
      ConversationRefDocument,
      'responseCount' | 'lastMessageAt' | 'summary' | 'role'
    >
  >
): Promise<void> {
  const collPath = Collections.conversationRefs(tenantId, targetAgentId)
  await adminDb.collection(collPath).doc(conversationId).update(updates)
}

export async function listConversationRefs(
  tenantId: string,
  agentId: string
): Promise<ConversationRefDocument[]> {
  const collPath = Collections.conversationRefs(tenantId, agentId)
  const snapshot = await adminDb
    .collection(collPath)
    .orderBy('lastMessageAt', 'desc')
    .get()

  return snapshot.docs.map(
    (doc: FirebaseFirestore.QueryDocumentSnapshot) =>
      doc.data() as ConversationRefDocument
  )
}

/**
 * Delete a conversation and its associated data (chunks and refs).
 */
export async function deleteConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<boolean> {
  const BATCH_LIMIT = 500

  // 1. Read the conversation document (single read for existence + handoffChain)
  const convDoc = await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .get()

  if (!convDoc.exists) return false

  // 2. Delete conversation_chunks for this conversation
  const chunksSnap = await adminDb
    .collection(Collections.conversationChunks(tenantId, agentId))
    .where('conversationId', '==', conversationId)
    .get()

  for (let i = 0; i < chunksSnap.docs.length; i += BATCH_LIMIT) {
    const batch = adminDb.batch()
    chunksSnap.docs
      .slice(i, i + BATCH_LIMIT)
      .forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) =>
        batch.delete(doc.ref)
      )
    await batch.commit()
  }

  // 3. Delete conversation_refs in target agents (from handoff chain)
  const data = convDoc.data()!
  const handoffChain = data.handoffChain as
    | Array<{ toAgentId: string }>
    | undefined
  if (handoffChain?.length) {
    for (const entry of handoffChain) {
      try {
        await adminDb
          .collection(Collections.conversationRefs(tenantId, entry.toAgentId))
          .doc(conversationId)
          .delete()
      } catch {
        // Ref may already be deleted
      }
    }
  }

  // 4. Delete the conversation document
  await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .delete()

  return true
}
