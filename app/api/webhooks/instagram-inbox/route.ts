import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import {
  processInboundMessage,
  processDeliveryUpdate,
  processReadUpdate,
} from '@/lib/instagram-inbox/webhook-handlers'

export const runtime = 'nodejs'

/**
 * GET — Webhook verification (Meta requirement).
 * Meta calls this with hub.mode, hub.verify_token, and hub.challenge.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.INSTAGRAM_INBOX_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Instagram Inbox] Webhook verified successfully')
    return new NextResponse(challenge, { status: 200 })
  }

  console.error('[Instagram Inbox] Webhook verification failed')
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  )
}

/**
 * POST — Handle inbound messages and status updates from Meta.
 * Verifies the payload signature, then processes messaging events.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()

    // Verify Meta webhook signature
    const signature = request.headers.get('x-hub-signature-256')
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret || !signature || !verifyWebhookSignature(rawBody, signature, appSecret)) {
      console.error('[Instagram Inbox] Invalid webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const body = JSON.parse(rawBody)

    if (body.object !== 'instagram') {
      return NextResponse.json(
        { error: 'Invalid object type' },
        { status: 400 }
      )
    }

    // Process each entry (each entry corresponds to a Page/IG account)
    for (const entry of body.entry || []) {
      const pageId = entry.id

      for (const event of entry.messaging || []) {
        // Handle inbound messages
        if (event.message && !event.message.is_echo && !event.message.is_deleted) {
          await processInboundMessage(pageId, event)
        }

        // Handle delivery receipts
        if (event.delivery) {
          await processDeliveryUpdate(event)
        }

        // Handle read receipts
        if (event.read) {
          await processReadUpdate(event)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Instagram Inbox] Webhook error:', error)
    // Always return 200 to prevent Meta from retrying
    return NextResponse.json({ success: true })
  }
}
