import { type Message, type VibeAgentConversation } from '@vibesboard/contracts'

import { and, eq, sql } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/sql/functions'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { conversations as conversationsTable } from '@vibesboard/adapter-postgres/schema'
import {
  listAgentConversations,
  getConversation
} from '@vibesboard/agents/conversations'
import { embedTexts } from './embeddings.ts'
import { providerFromDimension, selectTable } from './rag-store.ts'

type Db = PostgresJsDatabase<typeof schema>
interface Deps {
  db?: Db
  embed?: (texts: string[]) => Promise<number[][]>
}

const MAX_TOTAL_CONTEXT_CHARS = 12_000
const MAX_VECTOR_MATCHES = 48
const MAX_SOURCES = 10
const WINDOW_BEFORE = 2
const WINDOW_AFTER = 2
const MAX_MESSAGE_CHARS = 700
const FALLBACK_CONVERSATIONS = 12
const FALLBACK_MESSAGES_PER_CONVO = 10

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toISOString().slice(0, 10)
}

const roleLabel = (role: Message['role']) =>
  role === 'assistant' ? 'Agent' : 'User'

const truncate = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…`
}

const normalizeMessageContent = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

const renderMessageLines = (messages: Message[]) =>
  messages
    .map(message => {
      const content = truncate(
        normalizeMessageContent(message.content),
        MAX_MESSAGE_CHARS
      )
      if (!content) return null
      return `${roleLabel(message.role)}: ${content}`
    })
    .filter(Boolean)
    .join('\n')

export async function buildAskAiConversationContext(
  {
    tenantId,
    agentId,
    question,
    contextConversationId
  }: {
    tenantId: string
    agentId: string
    question: string
    contextConversationId?: string
  },
  deps: Deps = {}
): Promise<{
  context: string
  usedVectorSearch: boolean
  sourceCount: number
}> {
  const db = deps.db ?? getMigrateDb()
  const embed = deps.embed ?? embedTexts

  const trimmedQuestion = question.trim()
  if (!trimmedQuestion) {
    return {
      context: 'No question provided.',
      usedVectorSearch: false,
      sourceCount: 0
    }
  }

  const vectorContext = await buildVectorContext(
    {
      tenantId,
      agentId,
      question: trimmedQuestion,
      contextConversationId
    },
    { db, embed }
  )

  if (vectorContext.context.trim()) {
    return vectorContext
  }

  const fallbackContext = await buildFallbackContext(
    {
      tenantId,
      agentId,
      contextConversationId
    },
    { db }
  )
  return {
    context: fallbackContext,
    usedVectorSearch: false,
    sourceCount: fallbackContext ? 1 : 0
  }
}

async function buildVectorContext(
  {
    tenantId,
    agentId,
    question,
    contextConversationId
  }: {
    tenantId: string
    agentId: string
    question: string
    contextConversationId?: string
  },
  {
    db,
    embed
  }: { db: Db; embed: (texts: string[]) => Promise<number[][]> }
): Promise<{
  context: string
  usedVectorSearch: boolean
  sourceCount: number
}> {
  let queryEmbedding: number[] | null = null
  try {
    const vectors = await embed([question])
    queryEmbedding = vectors[0] ?? null
  } catch (error) {
    console.warn('Ask AI: failed to embed question', error)
    return { context: '', usedVectorSearch: false, sourceCount: 0 }
  }

  if (!queryEmbedding) {
    return { context: '', usedVectorSearch: false, sourceCount: 0 }
  }

  // Route the vector search to the correct table based on query embedding dimension
  const table = selectTable(providerFromDimension(queryEmbedding.length))
  const distance = cosineDistance(table.embedding, queryEmbedding)

  let hits: Array<{ conversationId: string; messageIndex: number }>
  try {
    const rows = await db
      .select({
        conversationId: table.sourceId,
        messageIndex: table.chunkIndex,
        distance: sql<number>`${distance}`
      })
      .from(table)
      .innerJoin(
        conversationsTable,
        eq(conversationsTable.id, table.sourceId)
      )
      .where(
        and(
          eq(table.tenantId, tenantId),
          eq(table.sourceType, 'conversation_chunk'),
          eq(conversationsTable.agentId, agentId),
          ...(contextConversationId
            ? [eq(table.sourceId, contextConversationId)]
            : [])
        )
      )
      .orderBy(distance)
      .limit(MAX_VECTOR_MATCHES)
    hits = rows.map(r => ({
      conversationId: r.conversationId,
      messageIndex: r.messageIndex
    }))
  } catch (error) {
    console.warn('Ask AI: vector match error', error)
    return { context: '', usedVectorSearch: false, sourceCount: 0 }
  }

  if (!hits.length) {
    return { context: '', usedVectorSearch: true, sourceCount: 0 }
  }

  const uniqueMessageHits: Array<{
    conversationId: string
    messageIndex: number
  }> = []
  const seen = new Set<string>()

  for (const hit of hits) {
    const key = `${hit.conversationId}:${hit.messageIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueMessageHits.push({
      conversationId: hit.conversationId,
      messageIndex: hit.messageIndex
    })
    if (uniqueMessageHits.length >= MAX_SOURCES) break
  }

  const conversationIds = Array.from(
    new Set(uniqueMessageHits.map(hit => hit.conversationId))
  )

  let conversations: VibeAgentConversation[]
  try {
    const results = await Promise.all(
      conversationIds.map(cid => getConversation(tenantId, agentId, cid, db))
    )
    conversations = results.filter(
      (c): c is VibeAgentConversation => c !== null && !!c.externalId
    )
  } catch (error) {
    console.warn('Ask AI: failed to fetch conversations for matches', error)
    return { context: '', usedVectorSearch: true, sourceCount: 0 }
  }

  const byId = new Map(conversations.map(convo => [convo.id, convo]))
  const labels = new Map<string, number>()
  let labelCounter = 1

  const blocks: string[] = []
  let totalChars = 0

  for (const hit of uniqueMessageHits) {
    const conversation = byId.get(hit.conversationId)
    if (!conversation) continue

    if (!labels.has(conversation.id)) {
      labels.set(conversation.id, labelCounter)
      labelCounter += 1
    }

    const label = labels.get(conversation.id) ?? 0
    const messages = conversation.messages ?? []
    const start = Math.max(0, hit.messageIndex - WINDOW_BEFORE)
    const end = Math.min(messages.length, hit.messageIndex + WINDOW_AFTER + 1)
    const window = messages.slice(start, end)
    const lines = renderMessageLines(window)
    if (!lines.trim()) continue

    const summary = conversation.summary?.trim()
    const headerParts = [
      `Conversation ${label}`,
      `Updated ${formatDate(conversation.updatedAt)}`
    ]
    if (summary) {
      headerParts.push(`Summary: ${truncate(summary, 140)}`)
    }

    const block = `--- ${headerParts.join(' • ')} ---\n${lines}`

    if (totalChars + block.length > MAX_TOTAL_CONTEXT_CHARS) {
      const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars
      if (remaining < 200) break
      blocks.push(block.slice(0, remaining))
      totalChars = MAX_TOTAL_CONTEXT_CHARS
      break
    }

    blocks.push(block)
    totalChars += block.length
  }

  return {
    context: blocks.join('\n\n'),
    usedVectorSearch: true,
    sourceCount: blocks.length
  }
}

async function buildFallbackContext(
  {
    tenantId,
    agentId,
    contextConversationId
  }: {
    tenantId: string
    agentId: string
    contextConversationId?: string
  },
  { db }: { db: Db }
): Promise<string> {
  let conversations: VibeAgentConversation[]
  try {
    if (contextConversationId) {
      const found = await getConversation(
        tenantId,
        agentId,
        contextConversationId,
        db
      )
      conversations = found ? [found] : []
    } else {
      const all = await listAgentConversations(tenantId, agentId, undefined, db)
      conversations = all
        .filter(c => c.externalId)
        .slice(0, FALLBACK_CONVERSATIONS)
    }
  } catch (error) {
    console.warn('Ask AI: fallback conversation query failed', error)
    return ''
  }

  if (!conversations.length) {
    return ''
  }

  const blocks: string[] = []
  let totalChars = 0

  conversations.forEach((conversation, index) => {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) return

    const messages = (conversation.messages ?? []).slice(
      -FALLBACK_MESSAGES_PER_CONVO
    )
    const lines = renderMessageLines(messages)
    if (!lines.trim()) return

    const summary = conversation.summary?.trim()
    const headerParts = [
      `Conversation ${index + 1}`,
      `Updated ${formatDate(conversation.updatedAt)}`
    ]
    if (summary) {
      headerParts.push(`Summary: ${truncate(summary, 140)}`)
    }

    let block = `--- ${headerParts.join(' • ')} ---\n${lines}`

    if (totalChars + block.length > MAX_TOTAL_CONTEXT_CHARS) {
      const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars
      if (remaining < 200) return
      block = block.slice(0, remaining)
    }

    blocks.push(block)
    totalChars += block.length
  })

  return blocks.join('\n\n')
}
