import { type Message } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'
import { type SupabaseClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/db_types'

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
  supabase: SupabaseClient<Database>
  agentId: string
  conversationId: string
  messages: Message[]
}

export async function upsertConversationEmbeddings({
  supabase,
  agentId,
  conversationId,
  messages
}: UpsertConversationEmbeddingsArgs) {
  const chunks = buildConversationChunks(messages)

  await supabase
    .from('vibe_agent_conversation_chunks')
    .delete()
    .eq('conversation_id', conversationId)

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

  const rows = chunks.map((chunk, idx) => ({
    agent_id: agentId,
    conversation_id: conversationId,
    message_index: chunk.messageIndex,
    chunk_index: chunk.chunkIndex,
    role: chunk.role,
    content: chunk.content,
    embedding: embeddings[idx]
  }))

  for (let i = 0; i < rows.length; i += MAX_BATCH_SIZE) {
    const batch = rows.slice(i, i + MAX_BATCH_SIZE)
    const { error } = await supabase
      .from('vibe_agent_conversation_chunks')
      .insert(batch as any)
    if (error) {
      console.error('Failed to upsert conversation chunk batch', error)
      break
    }
  }
}
