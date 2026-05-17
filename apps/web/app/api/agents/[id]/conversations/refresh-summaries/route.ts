import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getAgentById } from '@/lib/agents/server'
import { mapConversationDoc } from '@/lib/agents/db'
import { summarizeConversation } from '@/lib/agent/summarize'
import { canEditAgent } from '@/lib/agents/permissions'

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

  // Firestore can't easily combine != null with == null in compound queries,
  // so we query conversations with externalId != null and filter the rest in code.
  const convCollPath = Collections.conversations(agent.tenantId, agent.id)
  const snapshot = await adminDb
    .collection(convCollPath)
    .where('externalId', '!=', null)
    .orderBy('updatedAt', 'desc')
    .get()

  // Filter in memory: no userId (visitor conversations) and no summary yet
  const convoRows = snapshot.docs
    .map((doc: any) => ({ ref: doc.ref, data: doc.data() }))
    .filter(({ data }: any) => !data.userId && !data.summary)
    .slice(0, MAX_REFRESH)

  if (!convoRows.length) {
    return NextResponse.json({ updated: 0 })
  }

  let updatedCount = 0

  // Process in chunks to limit concurrency
  for (let i = 0; i < convoRows.length; i += CONCURRENCY) {
    const chunk = convoRows.slice(i, i + CONCURRENCY)

    const results = await Promise.all(
      chunk.map(async ({ ref, data }: any) => {
        try {
          const conversation = mapConversationDoc(data)
          const summary = await summarizeConversation(conversation.messages)

          if (!summary) {
            return false
          }

          const now = new Date().toISOString()
          await ref.update({
            summary,
            summaryGeneratedAt: now,
            updatedAt: now
          })

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
