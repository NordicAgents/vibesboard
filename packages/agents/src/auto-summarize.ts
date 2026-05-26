import { type Message } from '@vibesboard/contracts'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { conversations as conversationsTable } from '@vibesboard/adapter-postgres/schema'
import { summarizeConversation } from '@vibesboard/ai/summarize'

type Db = PostgresJsDatabase<typeof schema>

const MIN_RESPONSES_FOR_SUMMARY = 3
const RE_SUMMARIZE_DELTA = 5

interface AutoSummarizeArgs {
  tenantId: string
  agentId: string
  conversationId: string
  messages: Message[]
  currentSummary?: string | null
  summaryResponseCount?: number
  responseCounts?: Record<string, number>
}

interface Deps {
  db?: Db
  summarize?: (messages: Message[]) => Promise<string | null>
}

export async function maybeAutoSummarize(
  {
    tenantId,
    agentId,
    conversationId,
    messages,
    currentSummary,
    summaryResponseCount,
    responseCounts
  }: AutoSummarizeArgs,
  deps: Deps = {}
): Promise<void> {
  const db = deps.db ?? getMigrateDb()
  const summarize = deps.summarize ?? summarizeConversation

  const totalResponses = responseCounts
    ? Object.values(responseCounts).reduce((sum, n) => sum + n, 0) + 1
    : messages.filter((m) => m.role === 'assistant').length

  if (totalResponses < MIN_RESPONSES_FOR_SUMMARY) return

  if (currentSummary && summaryResponseCount != null) {
    if (totalResponses - summaryResponseCount < RE_SUMMARIZE_DELTA) return
  }

  const summary = await summarize(messages)
  if (!summary) return

  await db
    .update(conversationsTable)
    .set({
      summary,
      summaryGeneratedAt: new Date(),
      summaryResponseCount: totalResponses
    })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.id, conversationId)
      )
    )
}
