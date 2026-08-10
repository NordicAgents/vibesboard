import { type Message } from '@vibesboard/contracts'

import { and, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { createEmbedding } from '@vibesboard/adapter-openai'
import { ALL_EMBEDDING_TABLES, providerFromDimension, selectTable } from './rag-store.ts'

type Db = PostgresJsDatabase<typeof schema>

const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 200
const EMBEDDING_MODEL = 'text-embedding-3-small'

interface ConversationChunk {
  messageIndex: number
  chunkIndex: number
  role: Message['role']
  content: string
}

const chunkText = (value: string): string[] => {
  const chunks: string[] = []
  let cursor = 0

  while (cursor < value.length) {
    const end = Math.min(value.length, cursor + CHUNK_SIZE)
    chunks.push(value.slice(cursor, end))
    if (end >= value.length) {
      break
    }
    cursor += CHUNK_SIZE - CHUNK_OVERLAP
  }

  return chunks
}

export const buildConversationChunks = (
  messages: Message[]
): ConversationChunk[] => {
  const chunks: ConversationChunk[] = []

  messages.forEach((message, index) => {
    if (typeof message.content !== 'string') {
      return
    }
    const trimmed = message.content.trim()
    if (!trimmed) {
      return
    }
    const parts = chunkText(trimmed)
    parts.forEach((content, chunkIndex) => {
      chunks.push({
        messageIndex: index,
        chunkIndex,
        role: message.role,
        content
      })
    })
  })

  return chunks
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (!inputs.length) {
    return []
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const json = await createEmbedding({
    model: EMBEDDING_MODEL,
    input: inputs
  })

  if (!json?.data) {
    throw new Error('Failed to fetch embeddings')
  }

  return json.data.map(entry => entry.embedding)
}

interface UpsertConversationEmbeddingsArgs {
  tenantId: string
  agentId: string
  conversationId: string
  messages: Message[]
}

interface UpsertDeps {
  db?: Db
  embed?: (texts: string[], tenantId?: string) => Promise<number[][]>
}

/**
 * Replace all conversation_chunk embeddings for a conversation.
 * Routes to `embeddings` (768-dim) or `embeddings_1536` (1536-dim) based on
 * the dimension of the vectors — matching the dual-table strategy in rag-store.ts.
 */
export async function upsertConversationEmbeddings(
  { tenantId, conversationId, messages }: UpsertConversationEmbeddingsArgs,
  deps: UpsertDeps = {}
): Promise<void> {
  const db = deps.db ?? getMigrateDb()
  const embed = deps.embed ?? embedTexts
  const indexed = messages
    .map((m, i) => ({
      messageIndex: i,
      content: typeof m.content === 'string' ? m.content.trim() : ''
    }))
    .filter(c => c.content)

  if (!indexed.length) return

  let vectors: number[][] = []
  try {
    vectors = await embed(indexed.map(c => c.content), tenantId)
  } catch (error) {
    console.error('Failed to embed conversation chunks', error)
    return
  }

  if (!vectors.length) return

  // Route to correct table based on vector dimension
  // (768 → embeddings, 1536 → embeddings_1536, 384 → embeddings_384)
  const table = selectTable(providerFromDimension(vectors[0].length))

  await db.transaction(async tx => {
    // Delete from every table to handle provider switches cleanly
    for (const t of ALL_EMBEDDING_TABLES) {
      await tx.delete(t).where(
        and(eq(t.tenantId, tenantId), eq(t.sourceType, 'conversation_chunk'), eq(t.sourceId, conversationId))
      )
    }
    await tx.insert(table).values(
      indexed.map((c, i) => ({
        id: uuidv7(),
        tenantId,
        sourceType: 'conversation_chunk' as const,
        sourceId: conversationId,
        chunkIndex: c.messageIndex,
        content: c.content,
        contentTsv: sql`to_tsvector('english', ${c.content})`,
        embedding: vectors[i]
      }))
    )
  })
}

/** Delete all conversation_chunk embeddings for a conversation from every table. */
export async function deleteConversationEmbeddings(
  tenantId: string,
  conversationId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await Promise.all(
    ALL_EMBEDDING_TABLES.map(t =>
      db.delete(t).where(
        and(eq(t.tenantId, tenantId), eq(t.sourceType, 'conversation_chunk'), eq(t.sourceId, conversationId))
      )
    )
  )
}
