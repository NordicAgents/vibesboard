import { NextRequest, NextResponse } from 'next/server'

import { nanoid } from 'nanoid'

import {
  getChatwootConnectionById,
  verifyChatwootSignature
} from '@vibesboard/channel-chatwoot/connections'
import { handleChatwootMessage } from '@vibesboard/channel-chatwoot/agent-handler'
import { getAgentById } from '@vibesboard/agents/server'
import {
  consumeRateLimit,
  getRateLimitSalt
} from '@vibesboard/policy/rate-limit'
import {
  isConversationHandedOff,
  ensureConversation,
  updateConversationMessages
} from '@vibesboard/agents/conversations'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params

    // ── 1. Resolve the connection, then verify Chatwoot's HMAC over the
    // exact raw bytes before parsing attacker-controlled JSON.
    let connection
    try {
      connection = await getChatwootConnectionById(connectionId)
    } catch (err) {
      console.error('[chatwoot] Connection lookup failed', {
        error: err instanceof Error ? err.name : 'UnknownError'
      })
      return new NextResponse('Internal error', { status: 500 })
    }

    if (!connection) {
      console.warn('[chatwoot] No active connection found')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const signature = req.headers.get('x-chatwoot-signature')
    const timestamp = req.headers.get('x-chatwoot-timestamp')
    const deliveryId = req.headers.get('x-chatwoot-delivery')
    if (
      !signature ||
      !timestamp ||
      !deliveryId ||
      !/^[0-9a-f-]{36}$/i.test(deliveryId)
    ) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const rawBody = await req.text()
    if (
      !verifyChatwootSignature(
        rawBody,
        signature,
        timestamp,
        connection.webhookSecretHash
      )
    ) {
      console.warn('[chatwoot] Invalid webhook signature')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Chatwoot reuses X-Chatwoot-Delivery for retries. Anchor the fixed window
    // to the signed timestamp so the same delivery cannot cross a wall-clock
    // bucket boundary and execute twice.
    const replayGuard = await consumeRateLimit({
      scope: 'chatwoot-webhook-delivery',
      identifier: `${connection.id}:${deliveryId}`,
      salt: getRateLimitSalt(),
      limit: 1,
      windowMs: 24 * 60 * 60_000,
      now: new Date(Number(timestamp) * 1_000)
    })
    if (!replayGuard.allowed) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // ── 2. Parse Chatwoot webhook payload ─────────────────────────────
    let body: Record<string, any>
    try {
      body = JSON.parse(rawBody)
    } catch {
      return new NextResponse('Invalid JSON', { status: 400 })
    }

    console.log(
      `[chatwoot] Received webhook: event=${body.event}, message_type=${body.message_type}, content_length=${body.content?.length ?? 0}`
    )

    // Only process incoming messages (prevent echo loops from our own replies)
    if (body.event !== 'message_created') {
      console.log(`[chatwoot] Ignoring event: ${body.event}`)
      return NextResponse.json({ ok: true })
    }

    // Chatwoot sends message_type as string ("incoming") or number (0)
    const isIncoming =
      body.message_type === 'incoming' || body.message_type === 0
    if (!isIncoming) {
      console.log(
        `[chatwoot] Ignoring non-incoming message_type: ${body.message_type}`
      )
      return NextResponse.json({ ok: true })
    }

    // Skip messages from our own agent bot (echo prevention)
    if (connection.useAgentBot && body.sender?.type === 'agent_bot') {
      console.log(
        `[chatwoot] Ignoring message from agent bot (echo prevention)`
      )
      return NextResponse.json({ ok: true })
    }

    // Only process messages from the connected inbox
    const inboxId = body.inbox?.id ?? body.conversation?.inbox_id
    if (inboxId && inboxId !== connection.chatwootInboxId) {
      console.log(
        `[chatwoot] Ignoring message from inbox ${inboxId} (expected ${connection.chatwootInboxId})`
      )
      return NextResponse.json({ ok: true })
    }

    // Extract message content — fall back to attachment description for media messages
    let content: string = ''
    if (
      body.content &&
      typeof body.content === 'string' &&
      body.content.trim().length > 0
    ) {
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
        console.log('[chatwoot] Handed-off message stored without bot response')
        // Store the customer message so the human agent can see it in Vibesboard
        const userMessage = {
          id: nanoid(),
          role: 'user' as const,
          content: content.trim()
        }
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
          messages: allMessages
        })
        return NextResponse.json({ ok: true })
      }
    }

    // ── 3. Load agent ─────────────────────────────────────────────────
    const agent = await getAgentById(connection.agentId)
    if (!agent) {
      console.error('[chatwoot] Configured agent not found')
      return NextResponse.json({ ok: true })
    }

    // ── 4. Handle before acknowledging. Serverless runtimes may terminate
    // work as soon as the response is returned.
    const chatwootConversationId = body.conversation?.id
    const sender = body.sender ?? {}

    console.log('[chatwoot] Processing authenticated incoming message')

    await handleChatwootMessage(connection, agent, {
      conversationId: chatwootConversationId,
      content: content.trim(),
      senderName: sender.name ?? 'Unknown',
      senderId: sender.id ?? 0,
      inboxId: inboxId ?? connection.chatwootInboxId,
      accountId: connection.chatwootAccountId
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[chatwoot] Unexpected webhook error', {
      error: err instanceof Error ? err.name : 'UnknownError'
    })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
