import { findAccountByPageId } from '@/lib/instagram-inbox/accounts'
import { storeInboundMessage, updateMessageStatus } from '@/lib/instagram-inbox/messages'
import { triggerInboxAgent } from '@/lib/inbox-agent'
import type { InstagramWebhookMessage, InstagramSenderInfo } from '@/lib/instagram-inbox/types'
import type { InstagramInboxAccountDocument } from '@/lib/firestore-types'

/**
 * Process a single inbound message event (looks up account by pageId).
 */
export async function processInboundMessage(pageId: string, event: any) {
  const result = await findAccountByPageId(pageId)
  if (!result) {
    console.warn(
      `[Instagram Inbox] No active account found for Page ${pageId}`
    )
    return
  }

  await processInboundMessageForAccount(result.account, result.tenantId, pageId, event)
}

/**
 * Process a single inbound message for a known account (used by both platform and BYOA webhooks).
 */
export async function processInboundMessageForAccount(
  account: InstagramInboxAccountDocument,
  tenantId: string,
  pageId: string,
  event: any
) {
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
export async function processDeliveryUpdate(event: any) {
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
export async function processReadUpdate(event: any) {
  // Instagram read webhooks don't include specific message IDs,
  // they include a watermark timestamp. For now we skip granular
  // read tracking since Instagram doesn't provide per-message read receipts.
}
