import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { nanoid } from 'nanoid'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import {
  getConversation,
  updateConversationMessages
} from '@vibesboard/agents/conversations'
import { sendChatwootMessage } from '@vibesboard/channel-chatwoot/api-client'
import {
  listChatwootConnections,
  decryptToken
} from '@vibesboard/channel-chatwoot/connections'

export const runtime = 'nodejs'

const ReplySchema = z.object({
  text: z
    .string()
    .min(1, 'Message text is required')
    .max(4096, 'Message too long')
})

type RouteParams = {
  params: Promise<{ id: string; cid: string }>
}

/**
 * POST /api/agents/{id}/conversations/{cid}/reply
 * Send a human reply to a Chatwoot conversation.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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
    const validated = ReplySchema.parse(body)

    // Load conversation
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

    if (!chatwootAccountId || !chatwootConversationId) {
      return NextResponse.json(
        { error: 'Invalid Chatwoot conversation reference' },
        { status: 400 }
      )
    }

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

    // Use bot token for consistent identity, fall back to user token
    const token =
      connection.useAgentBot && connection.encryptedBotToken
        ? decryptToken(connection.encryptedBotToken)
        : decryptToken(connection.encryptedApiToken)

    // Send to Chatwoot
    await sendChatwootMessage(
      connection.chatwootUrl,
      token,
      chatwootAccountId,
      chatwootConversationId,
      validated.text
    )

    // Store in Firestore conversation
    const assistantMessage = {
      id: nanoid(),
      role: 'assistant' as const,
      content: validated.text
    }
    const allMessages = [...(conversation.messages ?? []), assistantMessage]
    await updateConversationMessages({
      tenantId: agent.tenantId,
      agentId,
      conversationId: cid,
      messages: allMessages
    })

    return NextResponse.json(
      { ok: true, messageId: assistantMessage.id },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }
    console.error('[chatwoot] Error sending human reply:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
