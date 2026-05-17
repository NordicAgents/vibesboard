import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import {
  getConversation,
  markConversationHandedOff,
  resumeConversation,
  deleteConversation
} from '@/lib/agents/conversations'
import { mapConversationDoc } from '@/lib/agents/db'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import {
  handoffChatwootConversation,
  resumeChatwootConversation
} from '@/lib/chatwoot/api-client'
import {
  listChatwootConnections,
  decryptToken
} from '@/lib/chatwoot/connections'

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

const PatchSchema = z.object({
  action: z.enum(['stop', 'resume'])
})

/**
 * PATCH /api/agents/{id}/conversations/{cid}
 * Stop or resume bot on a Chatwoot conversation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  try {
    const { id: agentId, cid } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agent = await getAgentById(agentId)
    if (!agent || !agent.tenantId) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const allowed = await canEditAgent({
      sessionUserId: auth.user.id,
      agentOwnerId: agent.userId,
      tenantId: agent.tenantId
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const validated = PatchSchema.parse(body)

    const conversation = await getConversation(agent.tenantId, agentId, cid)
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    if (!conversation.externalId?.startsWith('chatwoot:')) {
      return NextResponse.json(
        { error: 'This conversation is not a Chatwoot conversation' },
        { status: 400 }
      )
    }

    // Parse externalId: chatwoot:{accountId}:{chatwootConversationId}
    const parts = conversation.externalId.split(':')
    const chatwootAccountId = parseInt(parts[1], 10)
    const chatwootConversationId = parseInt(parts[2], 10)

    // Find matching Chatwoot connection
    const connections = await listChatwootConnections(
      agent.tenantId,
      agentId,
      'active'
    )
    const connection = connections.find(
      c => c.chatwootAccountId === chatwootAccountId
    )
    if (!connection) {
      return NextResponse.json(
        { error: 'No active Chatwoot connection found for this conversation' },
        { status: 404 }
      )
    }

    const userToken = decryptToken(connection.encryptedApiToken)

    if (validated.action === 'stop') {
      await markConversationHandedOff(agent.tenantId, agentId, cid)
      await handoffChatwootConversation(
        connection.chatwootUrl,
        userToken,
        chatwootAccountId,
        chatwootConversationId
      )
      return NextResponse.json({ ok: true, handedOff: true })
    } else {
      await resumeConversation(agent.tenantId, agentId, cid)
      await resumeChatwootConversation(
        connection.chatwootUrl,
        userToken,
        chatwootAccountId,
        chatwootConversationId
      )
      return NextResponse.json({ ok: true, handedOff: false })
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }
    console.error('[chatwoot] Error toggling conversation handoff:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agents/{id}/conversations/{cid}
 * Delete a visitor conversation and its associated data.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  try {
    const { id: agentId, cid } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agent = await getAgentById(agentId)
    if (!agent || !agent.tenantId) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const allowed = await canEditAgent({
      sessionUserId: auth.user.id,
      agentOwnerId: agent.userId,
      tenantId: agent.tenantId
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const deleted = await deleteConversation(agent.tenantId, agentId, cid)
    if (!deleted) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[conversation] Error deleting conversation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
