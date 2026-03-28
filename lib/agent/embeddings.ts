import { type Message } from '@/lib/types/message'
import { Configuration, OpenAIApi } from 'openai-edge'

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { Collections } from '@/lib/firestore-types'

const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 200
const MAX_BATCH_SIZE = 64
const EMBEDDING_MODEL = 'text-embedding-3-small'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

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

export const buildConversationChunks = (messages: Message[]): ConversationChunk[] => {
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

  const response = await openai.createEmbedding({
    model: EMBEDDING_MODEL,
    input: inputs
  })
  const json = await response.json()

  if (!json?.data) {
    throw new Error('Failed to fetch embeddings')
  }

  return (json.data as Array<{ embedding: number[] }>).map(entry => entry.embedding)
}

interface UpsertConversationEmbeddingsArgs {
  tenantId: string
  agentId: string
  conversationId: string
  messages: Message[]
}

export async function upsertConversationEmbeddings({
  tenantId,
  agentId,
  conversationId,
  messages
}: UpsertConversationEmbeddingsArgs) {
  const chunks = buildConversationChunks(messages)

  // Delete existing chunks for this conversation
  const collPath = Collections.conversationChunks(tenantId, agentId)
  const existingSnapshot = await adminDb
    .collection(collPath)
    .where('conversationId', '==', conversationId)
    .get()

  if (!existingSnapshot.empty) {
    const deleteBatch = adminDb.batch()
    existingSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref))
    await deleteBatch.commit()
  }

  if (!chunks.length) {
    return
  }

  let embeddings: number[][] = []
  try {
    embeddings = await embedTexts(chunks.map(chunk => chunk.content))
  } catch (error) {
    console.error('Failed to embed conversation chunks', error)
    return
  }

  // Insert new chunks using batch writes
  for (let i = 0; i < chunks.length; i += MAX_BATCH_SIZE) {
    const batchSlice = chunks.slice(i, i + MAX_BATCH_SIZE)
    const writeBatch = adminDb.batch()

    batchSlice.forEach((chunk, batchIdx) => {
      const idx = i + batchIdx
      const ref = adminDb.collection(collPath).doc()
      writeBatch.set(ref, {
        id: ref.id,
        agentId,
        conversationId,
        messageIndex: chunk.messageIndex,
        chunkIndex: chunk.chunkIndex,
        role: chunk.role,
        content: chunk.content,
        embedding: FieldValue.vector(embeddings[idx]),
        createdAt: new Date().toISOString()
      })
    })

    try {
      await writeBatch.commit()
    } catch (error) {
      console.error('Failed to upsert conversation chunk batch', error)
      break
    }
  }
}
