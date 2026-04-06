import { NextRequest, NextResponse } from 'next/server'

import { nanoid } from 'nanoid'

import { getChatwootConnectionById, verifyWebhookSecret } from '@/lib/chatwoot/connections'
import { handleChatwootMessage } from '@/lib/chatwoot/agent-handler'
import { getAgentById } from '@/lib/agents/server'
import {
  isConversationHandedOff,
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params

    // ── 1. Verify webhook secret ──────────────────────────────────────
    const secret = req.nextUrl.searchParams.get('secret')
    if (!secret) {
      return new NextResponse('Missing secret', { status: 401 })
    }

    let connection
    try {
      connection = await getChatwootConnectionById(connectionId)
    } catch (err) {
      console.error(`[chatwoot] Error looking up connection ${connectionId}:`, err)
      return new NextResponse('Internal error', { status: 500 })
    }

    if (!connection) {
      console.warn(`[chatwoot] No active connection found for ID: ${connectionId}`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    if (!verifyWebhookSecret(secret, connection.webhookSecretHash)) {
      console.warn(`[chatwoot] Invalid webhook secret for connection: ${connectionId}`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // ── 2. Parse Chatwoot webhook payload ─────────────────────────────
    let body: Record<string, any>
    try {
      body = await req.json()
    } catch {
      return new NextResponse('Invalid JSON', { status: 400 })
    }

    console.log(`[chatwoot] Received webhook: event=${body.event}, message_type=${body.message_type}, content_length=${body.content?.length ?? 0}`)

    // Only process incoming messages (prevent echo loops from our own replies)
    if (body.event !== 'message_created') {
      console.log(`[chatwoot] Ignoring event: ${body.event}`)
      return NextResponse.json({ ok: true })
    }

    // Chatwoot sends message_type as string ("incoming") or number (0)
    const isIncoming =
      body.message_type === 'incoming' || body.message_type === 0
    if (!isIncoming) {
      console.log(`[chatwoot] Ignoring non-incoming message_type: ${body.message_type}`)
      return NextResponse.json({ ok: true })
    }

    // Skip messages from our own agent bot (echo prevention)
    if (connection.useAgentBot && body.sender?.type === 'agent_bot') {
      console.log(`[chatwoot] Ignoring message from agent bot (echo prevention)`)
      return NextResponse.json({ ok: true })
    }

    // Only process messages from the connected inbox
    const inboxId = body.inbox?.id ?? body.conversation?.inbox_id
    if (inboxId && inboxId !== connection.chatwootInboxId) {
      console.log(`[chatwoot] Ignoring message from inbox ${inboxId} (expected ${connection.chatwootInboxId})`)
      return NextResponse.json({ ok: true })
    }

    // Extract message content — fall back to attachment description for media messages
    let content: string = ''
    if (body.content && typeof body.content === 'string' && body.content.trim().length > 0) {
      content = body.content.trim()
    } else if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      // Instagram/media messages may have no text content but include attachments
      const descriptions = body.attachments
        .map((a: Record<string, any>) => {
          const type = a.file_type || a.content_type || 'file'
          return `[${type}]`
        })
        .join(' ')
      content = `User sent: ${descriptions}`
    }

    if (!content) {
      console.log(`[chatwoot] Ignoring message with no content or attachments`)
      return NextResponse.json({ ok: true })
    }

    // Check if conversation has been handed off to human agents.
    // If so, store the incoming message but do NOT run the agent.
    if (connection.useAgentBot && body.conversation?.id) {
      const chatwootConvId = body.conversation.id
      const externalId = `chatwoot:${connection.chatwootAccountId}:${chatwootConvId}`
      const handedOff = await isConversationHandedOff(
        connection.tenantId,
        connection.agentId,
        externalId
      )
      if (handedOff) {
        console.log(`[chatwoot] Conversation ${chatwootConvId} was handed off, storing message without bot response`)
        // Store the customer message so the human agent can see it in Vibesboard
        const userMessage = { id: nanoid(), role: 'user' as const, content: content.trim() }
        const conversation = await ensureConversation({
          tenantId: connection.tenantId,
          agentId: connection.agentId,
          externalId
        })
        const allMessages = [...(conversation.messages ?? []), userMessage]
        await updateConversationMessages({
          tenantId: connection.tenantId,
          agentId: connection.agentId,
          conversationId: conversation.id,
          messages: allMessages,
          summary: null
        })
        return NextResponse.json({ ok: true })
      }
    }

    // ── 3. Load agent ─────────────────────────────────────────────────
    const agent = await getAgentById(connection.agentId)
    if (!agent) {
      console.error(`[chatwoot] Agent ${connection.agentId} not found`)
      return NextResponse.json({ ok: true })
    }

    // ── 4. Fire-and-forget: handle message async ──────────────────────
    const chatwootConversationId = body.conversation?.id
    const sender = body.sender ?? {}

    console.log(`[chatwoot] Processing message for agent "${agent.name}" from ${sender.name ?? 'Unknown'} in conversation ${chatwootConversationId}`)

    handleChatwootMessage(connection, agent, {
      conversationId: chatwootConversationId,
      content: content.trim(),
      senderName: sender.name ?? 'Unknown',
      senderId: sender.id ?? 0,
      inboxId: inboxId ?? connection.chatwootInboxId,
      accountId: connection.chatwootAccountId
    }).catch(err => {
      console.error('[chatwoot] Error handling message:', err)
    })

    // Always return 200 immediately to acknowledge the webhook
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[chatwoot] Unexpected webhook error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
