import { type Message } from '@vibesboard/contracts'

import { and, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { embeddings as embeddingsTable } from '@vibesboard/adapter-postgres/schema'
import { createEmbedding } from '@vibesboard/adapter-openai'

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
  embed?: (texts: string[]) => Promise<number[][]>
}

/**
 * Replace all conversation_chunk embeddings for a conversation (delete +
 * insert) in the unified `embeddings` table. One row per non-empty message;
 * `chunkIndex` = message index (the windowing key used by conversation-rag).
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

  await db.transaction(async tx => {
    await tx
      .delete(embeddingsTable)
      .where(
        and(
          eq(embeddingsTable.tenantId, tenantId),
          eq(embeddingsTable.sourceType, 'conversation_chunk'),
          eq(embeddingsTable.sourceId, conversationId)
        )
      )
    if (!indexed.length) return
    let vectors: number[][] = []
    try {
      vectors = await embed(indexed.map(c => c.content))
    } catch (error) {
      console.error('Failed to embed conversation chunks', error)
      return
    }
    await tx.insert(embeddingsTable).values(
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

/** Delete all conversation_chunk embeddings for a conversation. */
export async function deleteConversationEmbeddings(
  tenantId: string,
  conversationId: string,
  db: Db = getMigrateDb()
): Promise<void> {
  await db
    .delete(embeddingsTable)
    .where(
      and(
        eq(embeddingsTable.tenantId, tenantId),
        eq(embeddingsTable.sourceType, 'conversation_chunk'),
        eq(embeddingsTable.sourceId, conversationId)
      )
    )
}
