import { type Message } from '@vibesboard/contracts'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { conversations as conversationsTable } from '@vibesboard/adapter-postgres/schema'
import { summarizeConversation } from '@vibesboard/ai/summarize'
import { resolveProviderSpec } from '@vibesboard/ai/tenant-llm-config'

type Db = PostgresJsDatabase<typeof schema>

// Summarize when context is at 50% of the model's window.
// Conservative defaults per provider — we'd rather summarize a bit early
// than run out of context and get truncated responses.
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'o3': 200_000,
  'o3-mini': 128_000,
  'gpt-5.6-sol': 128_000,
  'gpt-5.6-terra': 128_000,
  'gpt-5.6-luna': 128_000,
  // Anthropic
  'claude-fable-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  // Google
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-3.5-flash': 1_000_000,
  // Ollama / local — conservative
  'smollm2': 8_192,
  'llama3.2': 131_072,
  'phi4-mini': 16_384,
  'mistral': 32_768,
  'nomic-embed-text': 8_192,
}

const DEFAULT_CONTEXT_WINDOW = 8_192  // safe fallback for unknown models

export function contextWindowForModel(modelId: string): number {
  return CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW
}

// Re-summarize when context grows by another 25% after the last summary
const RESUMMARIZE_THRESHOLD = 0.25

interface AutoSummarizeArgs {
  tenantId: string
  agentId: string
  conversationId: string
  messages: Message[]
  currentSummary?: string | null
  summaryResponseCount?: number
  responseCounts?: Record<string, number>
  /** Token usage from the last model response */
  tokenUsage?: { promptTokens?: number; completionTokens?: number }
}

interface Deps {
  db?: Db
  summarize?: (messages: Message[], tenantId?: string) => Promise<string | null>
}

export async function maybeAutoSummarize(
  {
    tenantId,
    agentId,
    conversationId,
    messages,
    currentSummary,
    summaryResponseCount,
    responseCounts,
    tokenUsage,
  }: AutoSummarizeArgs,
  deps: Deps = {}
): Promise<void> {
  const db = deps.db ?? getMigrateDb()
  const summarize = deps.summarize ?? summarizeConversation

  const promptTokens = tokenUsage?.promptTokens ?? 0
  // Resolve the tenant's current chat model to get the right context window
  const spec = await resolveProviderSpec(tenantId, null, undefined, 'chat').catch(() => null)
  const modelId = spec?.modelId ?? ''
  const contextWindow = contextWindowForModel(modelId)
  const usageRatio = promptTokens > 0 ? promptTokens / contextWindow : 0

  // Primary trigger: context ≥ 50%
  const needsSummary = usageRatio >= 0.5

  if (!needsSummary) return

  // Re-summarize guard: don't re-summarize unless context grew by another 25%
  // since the last summary. summaryResponseCount is reused as a token marker.
  if (currentSummary && summaryResponseCount != null) {
    const tokensSinceLastSummary = promptTokens - summaryResponseCount
    if (tokensSinceLastSummary < contextWindow * RESUMMARIZE_THRESHOLD) return
  }

  const summary = await summarize(messages, tenantId)
  if (!summary) return

  await db
    .update(conversationsTable)
    .set({
      summary,
      summaryGeneratedAt: new Date(),
      // Store current promptTokens as a marker for the re-summarize guard
      summaryResponseCount: promptTokens,
    })
    .where(
      and(
        eq(conversationsTable.tenantId, tenantId),
        eq(conversationsTable.id, conversationId)
      )
    )
}
