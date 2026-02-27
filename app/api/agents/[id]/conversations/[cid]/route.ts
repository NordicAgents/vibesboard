import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { getConversation } from '@/lib/agents/conversations'
import { mapConversationDoc } from '@/lib/agents/db'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const { id, cid } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const doc = await adminDb
    .collection(Collections.conversations(agent.tenantId, agent.id))
    .doc(cid)
    .get()

  if (!doc.exists) {
    return new NextResponse('Not found', { status: 404 })
  }

  const data = doc.data()!
  if (data.agentId !== id) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json({ conversation: mapConversationDoc(data) })
}
