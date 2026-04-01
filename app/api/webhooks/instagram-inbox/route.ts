import { NextRequest, NextResponse } from 'next/server'
import { findAccountByPageId } from '@/lib/instagram-inbox/accounts'
import { storeInboundMessage, updateMessageStatus } from '@/lib/instagram-inbox/messages'
import { verifyWebhookSignature } from '@/lib/webhooks/verification'
import { triggerInboxAgent } from '@/lib/inbox-agent'
import type { InstagramWebhookMessage, InstagramSenderInfo } from '@/lib/instagram-inbox/types'

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
 *
 * Instagram webhook structure:
 * {
 *   object: "instagram",
 *   entry: [{
 *     id: "<PAGE_ID>",
 *     time: 1234567890,
 *     messaging: [{
 *       sender: { id: "<SENDER_IGSID>" },
 *       recipient: { id: "<RECIPIENT_IGSID>" },
 *       timestamp: 1234567890,
 *       message?: { mid, text?, attachments? },
 *       delivery?: { mids, watermark },
 *       read?: { watermark }
 *     }]
 *   }]
 * }
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

/**
 * Process a single inbound message event.
 */
async function processInboundMessage(pageId: string, event: any) {
  const result = await findAccountByPageId(pageId)
  if (!result) {
    console.warn(
      `[Instagram Inbox] No active account found for Page ${pageId}`
    )
    return
  }

  const { account, tenantId } = result
  const senderIgsid = event.sender?.id

  if (!senderIgsid) return

  try {
    const message: InstagramWebhookMessage = {
      mid: event.message.mid,
      text: event.message.text,
      attachments: event.message.attachments,
      is_echo: event.message.is_echo,
      is_deleted: event.message.is_deleted,
    }

    const sender: InstagramSenderInfo = {
      id: senderIgsid,
    }

    await storeInboundMessage({
      tenantId,
      accountId: account.id,
      pageId,
      message,
      sender,
    })

    // Fire-and-forget: trigger agent if assigned
    const messageText = message.text || ''
    if (messageText) {
      triggerInboxAgent({
        channel: 'instagram',
        tenantId,
        accountId: account.id,
        contactId: senderIgsid,
        messageText,
        windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }).catch((err) => {
        console.error('[Instagram Inbox] Agent handler error:', err)
      })
    }
  } catch (err) {
    console.error(
      `[Instagram Inbox] Failed to store message ${event.message?.mid}:`,
      err
    )
  }
}

/**
 * Process delivery status updates.
 */
async function processDeliveryUpdate(event: any) {
  const mids = event.delivery?.mids || []
  for (const mid of mids) {
    try {
      await updateMessageStatus(mid, 'delivered')
    } catch (err) {
      console.error(
        `[Instagram Inbox] Failed to update delivery status for ${mid}:`,
        err
      )
    }
  }
}

/**
 * Process read receipts.
 */
async function processReadUpdate(event: any) {
  // Instagram read webhooks don't include specific message IDs,
  // they include a watermark timestamp. For now we skip granular
  // read tracking since Instagram doesn't provide per-message read receipts.
  // This is a placeholder for future enhancement.
}
