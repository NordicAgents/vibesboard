import { NextRequest, NextResponse } from 'next/server'

import { getChatwootConnectionById, verifyWebhookSecret } from '@/lib/chatwoot/connections'
import { handleChatwootMessage } from '@/lib/chatwoot/agent-handler'
import { getAgentById } from '@/lib/agents/server'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const { connectionId } = await params

  // ── 1. Verify webhook secret ──────────────────────────────────────
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret) {
    return new NextResponse('Missing secret', { status: 401 })
  }

  const connection = await getChatwootConnectionById(connectionId)
  if (!connection) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (!verifyWebhookSecret(secret, connection.webhookSecretHash)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // ── 2. Parse Chatwoot webhook payload ─────────────────────────────
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  // Only process incoming messages (prevent echo loops from our own replies)
  if (body.event !== 'message_created') {
    return NextResponse.json({ ok: true })
  }

  if (body.message_type !== 'incoming') {
    return NextResponse.json({ ok: true })
  }

  // Only process messages from the connected inbox
  const inboxId = body.inbox?.id ?? body.conversation?.inbox_id
  if (inboxId && inboxId !== connection.chatwootInboxId) {
    return NextResponse.json({ ok: true })
  }

  // Extract message content
  const content = body.content
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ ok: true })
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
}
