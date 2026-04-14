import { type Message } from '@/lib/types/message'

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { Collections } from '@/lib/firestore-types'
import { embedTexts } from '@/lib/agent/embeddings'
import { mapConversationRow } from '@/lib/agents/db'

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

export async function buildAskAiConversationContext({
  tenantId,
  agentId,
  question,
  contextConversationId
}: {
  tenantId: string
  agentId: string
  question: string
  contextConversationId?: string
}): Promise<{
  context: string
  usedVectorSearch: boolean
  sourceCount: number
}> {
  const trimmedQuestion = question.trim()
  if (!trimmedQuestion) {
    return {
      context: 'No question provided.',
      usedVectorSearch: false,
      sourceCount: 0
    }
  }

  const vectorContext = await buildVectorContext({
    tenantId,
    agentId,
    question: trimmedQuestion,
    contextConversationId
  })

  if (vectorContext.context.trim()) {
    return vectorContext
  }

  const fallbackContext = await buildFallbackContext({
    tenantId,
    agentId,
    contextConversationId
  })
  return {
    context: fallbackContext,
    usedVectorSearch: false,
    sourceCount: fallbackContext ? 1 : 0
  }
}

async function buildVectorContext({
  tenantId,
  agentId,
  question,
  contextConversationId
}: {
  tenantId: string
  agentId: string
  question: string
  contextConversationId?: string
}): Promise<{
  context: string
  usedVectorSearch: boolean
  sourceCount: number
}> {
  let queryEmbedding: number[] | null = null
  try {
    const embeddings = await embedTexts([question])
    queryEmbedding = embeddings[0] ?? null
  } catch (error) {
    console.warn('Ask AI: failed to embed question', error)
    return { context: '', usedVectorSearch: false, sourceCount: 0 }
  }

  if (!queryEmbedding) {
    return { context: '', usedVectorSearch: false, sourceCount: 0 }
  }

  const collPath = Collections.conversationChunks(tenantId, agentId)

  let snapshot: FirebaseFirestore.QuerySnapshot
  try {
    snapshot = await adminDb
      .collection(collPath)
      .findNearest('embedding', FieldValue.vector(queryEmbedding), {
        limit: MAX_VECTOR_MATCHES,
        distanceMeasure: 'COSINE'
      })
      .get()
  } catch (error) {
    console.warn('Ask AI: vector match error', error)
    return { context: '', usedVectorSearch: false, sourceCount: 0 }
  }

  let rows = snapshot.docs.map(doc => doc.data())

  // Post-query filter for contextConversationId since findNearest
  // does not support compound where clauses easily
  if (contextConversationId) {
    rows = rows.filter(row => row.conversationId === contextConversationId)
  }

  if (!rows.length) {
    return { context: '', usedVectorSearch: true, sourceCount: 0 }
  }

  const uniqueMessageHits: Array<{
    conversationId: string
    messageIndex: number
  }> = []
  const seen = new Set<string>()

  for (const row of rows) {
    const key = `${row.conversationId}:${row.messageIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueMessageHits.push({
      conversationId: row.conversationId,
      messageIndex: row.messageIndex
    })
    if (uniqueMessageHits.length >= MAX_SOURCES) break
  }

  const conversationIds = Array.from(
    new Set(uniqueMessageHits.map(hit => hit.conversationId))
  )

  const convCollPath = Collections.conversations(tenantId, agentId)
  let conversations: ReturnType<typeof mapConversationRow>[]
  try {
    const convResults = await Promise.all(
      conversationIds.map(async cid => {
        const doc = await adminDb.collection(convCollPath).doc(cid).get()
        return doc.exists ? mapConversationRow(doc.data()!) : null
      })
    )
    conversations = convResults.filter(
      (c): c is NonNullable<typeof c> => c !== null && !!c.externalId
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

async function buildFallbackContext({
  tenantId,
  agentId,
  contextConversationId
}: {
  tenantId: string
  agentId: string
  contextConversationId?: string
}): Promise<string> {
  const convCollPath = Collections.conversations(tenantId, agentId)

  let snapshot: FirebaseFirestore.QuerySnapshot
  try {
    if (contextConversationId) {
      snapshot = await adminDb
        .collection(convCollPath)
        .where('id', '==', contextConversationId)
        .limit(1)
        .get()
    } else {
      // Fetch recent conversations sorted by updatedAt and filter for visitor
      // conversations (those with externalId) in memory to avoid a composite index.
      snapshot = await adminDb
        .collection(convCollPath)
        .orderBy('updatedAt', 'desc')
        .limit(FALLBACK_CONVERSATIONS * 3)
        .get()
    }
  } catch (error) {
    console.warn('Ask AI: fallback conversation query failed', error)
    return ''
  }

  const conversations = snapshot.docs
    .map(doc => mapConversationRow(doc.data()!))
    .filter(c => contextConversationId || c.externalId)
    .slice(0, FALLBACK_CONVERSATIONS)
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
