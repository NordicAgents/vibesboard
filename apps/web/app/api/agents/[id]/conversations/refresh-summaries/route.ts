import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import {
  listUnsummarizedVisitorConversations,
  updateConversationSummary
} from '@vibesboard/agents/conversations'
import { summarizeConversation } from '@vibesboard/ai/summarize'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

const MAX_REFRESH = 20
const CONCURRENCY = 5

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const { user } = authResult

  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const convoRows = await listUnsummarizedVisitorConversations(
    agent.tenantId,
    agent.id,
    MAX_REFRESH
  )

  if (!convoRows.length) {
    return NextResponse.json({ updated: 0 })
  }

  let updatedCount = 0

  // Process in chunks to limit concurrency
  for (let i = 0; i < convoRows.length; i += CONCURRENCY) {
    const chunk = convoRows.slice(i, i + CONCURRENCY)

    const results = await Promise.all(
      chunk.map(async conversation => {
        try {
          const summary = await summarizeConversation(
            conversation.messages,
            agent?.tenantId
          )

          if (!summary) {
            return false
          }

          await updateConversationSummary(
            agent.tenantId,
            agent.id,
            conversation.id,
            summary
          )

          return true
        } catch (err) {
          console.error('Error processing conversation summary:', err)
          return false
        }
      })
    )

    updatedCount += results.filter(Boolean).length
  }

  return NextResponse.json({ updated: updatedCount })
}
