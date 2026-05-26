import { findAccountByWabaId } from '@vibesboard/channel-whatsapp/accounts'
import {
  storeInboundMessage,
  updateMessageStatus
} from '@vibesboard/channel-whatsapp/messages'
import { triggerInboxAgent } from '@vibesboard/inbox'
import type {
  MetaWebhookMessage,
  MetaWebhookContact
} from '@vibesboard/channel-whatsapp/types'
import type { WhatsAppInboxAccountDocument } from '@vibesboard/contracts'

/**
 * Process inbound messages: find tenant by WABA ID, store messages.
 */
export async function processInboundMessages(
  wabaId: string,
  phoneNumberId: string,
  messages: MetaWebhookMessage[],
  contacts?: MetaWebhookContact[]
) {
  const result = await findAccountByWabaId(wabaId)
  if (!result) {
    console.warn(`[WhatsApp Inbox] No active account found for WABA ${wabaId}`)
    return
  }

  await processInboundMessagesForAccount(
    result.account,
    result.tenantId,
    wabaId,
    phoneNumberId,
    messages,
    contacts
  )
}

/**
 * Process inbound messages for a known account (used by both platform and BYOA webhooks).
 */
export async function processInboundMessagesForAccount(
  account: WhatsAppInboxAccountDocument,
  tenantId: string,
  wabaId: string,
  phoneNumberId: string,
  messages: MetaWebhookMessage[],
  contacts?: MetaWebhookContact[]
) {
  for (const message of messages) {
    try {
      const contact = contacts?.find(c => c.wa_id === message.from)

      await storeInboundMessage({
        tenantId,
        accountId: account.id,
        wabaId,
        phoneNumberId,
        message,
        contact
      })

      // Fire-and-forget: trigger agent if assigned
      const messageText =
        message.type === 'text'
          ? message.text?.body
          : message.image?.caption ||
            message.video?.caption ||
            message.document?.caption
      if (messageText) {
        triggerInboxAgent({
          channel: 'whatsapp',
          tenantId,
          accountId: account.id,
          contactId: message.from.replace(/\D/g, ''),
          contactName: contact?.profile?.name,
          messageText,
          windowExpiresAt: new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString()
        }).catch(err => {
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
export async function processStatusUpdates(statuses: any[]) {
  for (const status of statuses) {
    try {
      const messageId = status.id
      const statusType = status.status as string
      const timestamp = status.timestamp
        ? new Date(parseInt(status.timestamp) * 1000).toISOString()
        : undefined

      if (['sent', 'delivered', 'read', 'failed'].includes(statusType)) {
        await updateMessageStatus(messageId, statusType as any, timestamp)
      }
    } catch (err) {
      console.error(
        `[WhatsApp Inbox] Failed to update status for ${status.id}:`,
        err
      )
    }
  }
}
