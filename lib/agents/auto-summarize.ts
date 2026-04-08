import { type Message } from '@/lib/types/message'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { summarizeConversation } from '@/lib/agent/summarize'

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

export async function maybeAutoSummarize({
  tenantId,
  agentId,
  conversationId,
  messages,
  currentSummary,
  summaryResponseCount,
  responseCounts
}: AutoSummarizeArgs): Promise<void> {
  const totalResponses = responseCounts
    ? Object.values(responseCounts).reduce((sum, n) => sum + n, 0) + 1
    : messages.filter(m => m.role === 'assistant').length

  if (totalResponses < MIN_RESPONSES_FOR_SUMMARY) return

  if (currentSummary && summaryResponseCount != null) {
    if (totalResponses - summaryResponseCount < RE_SUMMARIZE_DELTA) return
  }

  const summary = await summarizeConversation(messages)
  if (!summary) return

  await adminDb
    .collection(Collections.conversations(tenantId, agentId))
    .doc(conversationId)
    .update({
      summary,
      summaryGeneratedAt: new Date().toISOString(),
      summaryResponseCount: totalResponses
    })
}
