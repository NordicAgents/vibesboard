import {
  SendMessageParams,
  BotResponse,
  WhatsAppAPIResponse
} from './message-types'

const WHATSAPP_LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  buttonTitle: 20,
  buttonId: 256,
  listButtonLabel: 20,
  listRowTitle: 24,
  listRowDescription: 72,
  listRowId: 200
} as const

function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncateWithEllipsis(text: string, maxLen: number): string {
  if (maxLen <= 0) return ''
  if (text.length <= maxLen) return text
  if (maxLen <= 3) return text.slice(0, maxLen)
  return `${text.slice(0, maxLen - 3).trimEnd()}...`
}

function truncatePlain(text: string, maxLen: number): string {
  if (maxLen <= 0) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen)
}

function sanitizeInteractiveBodyText(text: string): string {
  const cleaned = stripControlChars(text ?? '').trim()
  const safe = cleaned.length
    ? cleaned
    : "I'm here to help. How can I assist you?"
  return truncateWithEllipsis(safe, WHATSAPP_LIMITS.interactiveBody)
}

function sanitizeTextBody(text: string): string {
  const cleaned = stripControlChars(text ?? '').trim()
  const safe = cleaned.length
    ? cleaned
    : "I'm here to help. How can I assist you?"
  return truncateWithEllipsis(safe, WHATSAPP_LIMITS.textBody)
}

function sanitizeReplyButtonTitle(title: string): string {
  const normalized = normalizeWhitespace(stripControlChars(title ?? ''))
  return truncateWithEllipsis(normalized, WHATSAPP_LIMITS.buttonTitle)
}

function sanitizeReplyButtonId(title: string, index: number): string {
  const base = normalizeWhitespace(stripControlChars(title ?? ''))
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
  const fallback = `BUTTON_${index + 1}`
  const id = base.length ? base : fallback
  return truncatePlain(id, WHATSAPP_LIMITS.buttonId)
}

function sanitizeListRowId(id: string | undefined, index: number): string {
  const normalized = normalizeWhitespace(stripControlChars(id ?? ''))
  const safe = normalized.length ? normalized : `row_${index + 1}`
  return truncatePlain(safe, WHATSAPP_LIMITS.listRowId)
}

function sanitizeListRowTitle(title: string, index: number): string {
  const normalized = normalizeWhitespace(stripControlChars(title ?? ''))
  const safe = normalized.length ? normalized : `Option ${index + 1}`
  return truncateWithEllipsis(safe, WHATSAPP_LIMITS.listRowTitle)
}

function sanitizeListRowDescription(
  description: string | undefined
): string | undefined {
  if (!description) return undefined
  const normalized = normalizeWhitespace(stripControlChars(description))
  if (!normalized) return undefined
  return truncateWithEllipsis(normalized, WHATSAPP_LIMITS.listRowDescription)
}

function sanitizeListButtonLabel(label: string): string {
  const normalized = normalizeWhitespace(stripControlChars(label ?? ''))
  const safe = normalized.length ? normalized : 'Select'
  return truncateWithEllipsis(safe, WHATSAPP_LIMITS.listButtonLabel)
}

/**
 * Sends a message via Meta WhatsApp Graph API.
 * Supports text, interactive buttons, lists, and flows.
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<WhatsAppAPIResponse> {
  const { to, response, phoneNumberId, accessToken } = params
  const toNormalized = to.replace(/\D/g, '')
  if (!toNormalized) {
    throw new Error('Invalid recipient phone number')
  }
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toNormalized
  }

  // Build message based on type
  if (response.type === 'buttons' && response.buttons) {
    body.type = 'interactive'
    const safeBodyText = sanitizeInteractiveBodyText(response.text)
    const rawButtons = response.buttons
      .map((btn, index) => ({
        title: sanitizeReplyButtonTitle(btn),
        id: sanitizeReplyButtonId(btn, index)
      }))
      .filter(b => Boolean(b.title))
      .slice(0, 3)

    // If buttons are invalid/empty after sanitization, fall back to text.
    if (rawButtons.length === 0) {
      body.type = 'text'
      body.text = { body: sanitizeTextBody(response.text) }
    } else {
      body.interactive = {
        type: 'button',
        body: { text: safeBodyText },
        action: {
          buttons: rawButtons.map((b, index) => ({
            type: 'reply',
            reply: {
              id: b.id || `BUTTON_${index + 1}`,
              title: b.title
            }
          }))
        }
      }
    }
  } else if (response.type === 'list' && response.options) {
    body.type = 'interactive'
    const safeBodyText = sanitizeInteractiveBodyText(response.text)
    const safeOptions = response.options
      .map((opt, index) => ({
        id: sanitizeListRowId(opt.id, index),
        title: sanitizeListRowTitle(opt.title, index),
        description: sanitizeListRowDescription(opt.description)
      }))
      .filter(o => Boolean(o.id) && Boolean(o.title))
      .slice(0, 10)

    if (safeOptions.length === 0) {
      body.type = 'text'
      body.text = { body: sanitizeTextBody(response.text) }
    } else {
      body.interactive = {
        type: 'list',
        body: { text: safeBodyText },
        action: {
          button: sanitizeListButtonLabel('Select Option'),
          sections: [
            {
              title: 'Options',
              rows: safeOptions
            }
          ]
        }
      }
    }
  } else if (response.type === 'flow' && response.flow) {
    body.type = 'interactive'
    const safeBodyText = sanitizeInteractiveBodyText(response.text)
    body.interactive = {
      type: 'flow',
      header: {
        type: 'text',
        text: 'Action Required'
      },
      body: {
        text: safeBodyText
      },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: 'unused',
          flow_id: response.flow.flow_id,
          flow_cta: truncateWithEllipsis(
            normalizeWhitespace(stripControlChars(response.flow.cta_text)),
            WHATSAPP_LIMITS.listButtonLabel
          ),
          flow_action: 'navigate',
          flow_action_payload: {
            screen: response.flow.screen,
            data: response.flow.data || {}
          }
        }
      }
    }
    // Use Draft mode for testing if specified
    if (response.flow.mode === 'draft') {
      ;(body.interactive as Record<string, any>).action.parameters.mode =
        'draft'
    }
  } else {
    // Default: text message
    body.type = 'text'
    body.text = { body: sanitizeTextBody(response.text) }
  }

  console.log(
    '📤 Sending WhatsApp message to:',
    to,
    `(normalized: ${toNormalized})`
  )
  console.log('Message type:', response.type)
  console.log('📦 Full payload:', JSON.stringify(body, null, 2))

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    })

    const responseData = (await res.json()) as WhatsAppAPIResponse
    console.log(
      '📬 WhatsApp API Response:',
      JSON.stringify(responseData, null, 2)
    )

    if (!res.ok) {
      console.error(
        '❌ WhatsApp API Error:',
        JSON.stringify(responseData, null, 2)
      )

      if (responseData.error?.code === 190) {
        throw new Error(
          'WHATSAPP_AUTH_EXPIRED: The WhatsApp access token has expired or is invalid.'
        )
      }

      throw new Error(
        `WhatsApp API Error: ${responseData.error?.message || 'Unknown error'}`
      )
    }

    console.log(
      '✅ Message sent successfully. Message ID:',
      responseData.messages?.[0]?.id
    )
    return responseData
  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error)
    throw error
  }
}
