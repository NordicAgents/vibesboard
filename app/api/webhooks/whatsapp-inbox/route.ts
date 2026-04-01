import { NextRequest, NextResponse } from 'next/server'
import { findAccountByWabaId } from '@/lib/whatsapp-inbox/accounts'
import { storeInboundMessage, updateMessageStatus } from '@/lib/whatsapp-inbox/messages'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import { triggerInboxAgent } from '@/lib/inbox-agent'
import type { MetaWebhookMessage, MetaWebhookContact } from '@/lib/whatsapp-inbox/types'

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
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  )
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
    if (!appSecret || !signature || !verifyWebhookSignature(rawBody, signature, appSecret)) {
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

/**
 * Process inbound messages: find tenant by WABA ID, store messages.
 */
async function processInboundMessages(
  wabaId: string,
  phoneNumberId: string,
  messages: MetaWebhookMessage[],
  contacts?: MetaWebhookContact[]
) {
  const result = await findAccountByWabaId(wabaId)
  if (!result) {
    console.warn(
      `[WhatsApp Inbox] No active account found for WABA ${wabaId}`
    )
    return
  }

  const { account, tenantId } = result

  for (const message of messages) {
    try {
      const contact = contacts?.find((c) => c.wa_id === message.from)

      await storeInboundMessage({
        tenantId,
        accountId: account.id,
        wabaId,
        phoneNumberId,
        message,
        contact,
      })

      // Fire-and-forget: trigger agent if assigned
      const messageText = message.type === 'text'
        ? message.text?.body
        : message.image?.caption || message.video?.caption || message.document?.caption
      if (messageText) {
        triggerInboxAgent({
          channel: 'whatsapp',
          tenantId,
          accountId: account.id,
          contactId: message.from.replace(/\D/g, ''),
          contactName: contact?.profile?.name,
          messageText,
          windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }).catch((err) => {
          console.error('[WhatsApp Inbox] Agent handler error:', err)
        })
      }
    } catch (err) {
      console.error(
        `[WhatsApp Inbox] Failed to store message ${message.id}:`,
        err
      )
    }
  }
}

/**
 * Process message status updates (delivered, read, failed).
 */
async function processStatusUpdates(statuses: any[]) {
  for (const status of statuses) {
    try {
      const messageId = status.id
      const statusType = status.status as string
      const timestamp = status.timestamp
        ? new Date(parseInt(status.timestamp) * 1000).toISOString()
        : undefined

      if (['sent', 'delivered', 'read', 'failed'].includes(statusType)) {
        await updateMessageStatus(
          messageId,
          statusType as any,
          timestamp
        )
      }
    } catch (err) {
      console.error(
        `[WhatsApp Inbox] Failed to update status for ${status.id}:`,
        err
      )
    }
  }
}
