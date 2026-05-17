import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import {
  processInboundMessages,
  processStatusUpdates
} from '@vibesboard/channel-whatsapp/webhook-handlers'

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

  const verifyToken = process.env.WHATSAPP_INBOX_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp Inbox] Webhook verified successfully')
    return new NextResponse(challenge, { status: 200 })
  }

  console.error('[WhatsApp Inbox] Webhook verification failed')
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

/**
 * POST — Handle inbound messages and status updates from Meta.
 * Verifies the payload signature, then processes messages before returning.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()

    // Verify Meta webhook signature
    const signature = request.headers.get('x-hub-signature-256')
    const appSecret = process.env.META_APP_SECRET
    if (
      !appSecret ||
      !signature ||
      !verifyWebhookSignature(rawBody, signature, appSecret)
    ) {
      console.error('[WhatsApp Inbox] Invalid webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const body = JSON.parse(rawBody)

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json(
        { error: 'Invalid object type' },
        { status: 400 }
      )
    }

    // Process each entry (each entry corresponds to a WABA)
    for (const entry of body.entry || []) {
      const wabaId = entry.id

      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue

        const value = change.value
        const phoneNumberId = value.metadata?.phone_number_id

        // Handle inbound messages
        if (value.messages && value.messages.length > 0) {
          await processInboundMessages(
            wabaId,
            phoneNumberId,
            value.messages,
            value.contacts
          )
        }

        // Handle status updates (sent, delivered, read, failed)
        if (value.statuses && value.statuses.length > 0) {
          await processStatusUpdates(value.statuses)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[WhatsApp Inbox] Webhook error:', error)
    // Always return 200 to prevent Meta from retrying
    return NextResponse.json({ success: true })
  }
}
