import {
  SendMessageParams,
  BotResponse,
  WhatsAppAPIResponse
} from './message-types'

/**
 * Sends a message via Meta WhatsApp Graph API.
 * Supports text, interactive buttons, lists, and flows.
 */
export async function sendWhatsAppMessage(
  params: SendMessageParams
): Promise<WhatsAppAPIResponse> {
  const { to, response, phoneNumberId, accessToken } = params
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to
  }

  // Build message based on type
  if (response.type === 'buttons' && response.buttons) {
    body.type = 'interactive'
    body.interactive = {
      type: 'button',
      body: { text: response.text },
      action: {
        buttons: response.buttons.map(btn => ({
          type: 'reply',
          reply: {
            id: btn.toUpperCase().replace(/\s+/g, '_'),
            title: btn
          }
        }))
      }
    }
  } else if (response.type === 'list' && response.options) {
    body.type = 'interactive'
    body.interactive = {
      type: 'list',
      body: { text: response.text },
      action: {
        button: 'Select Option',
        sections: [
          {
            title: 'Options',
            rows: response.options.map(opt => ({
              id: opt.id,
              title: opt.title.substring(0, 24), // Meta limit
              description: opt.description
                ? opt.description.substring(0, 72)
                : undefined
            }))
          }
        ]
      }
    }
  } else if (response.type === 'flow' && response.flow) {
    body.type = 'interactive'
    body.interactive = {
      type: 'flow',
      header: {
        type: 'text',
        text: 'Action Required'
      },
      body: {
        text: response.text
      },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: 'unused',
          flow_id: response.flow.flow_id,
          flow_cta: response.flow.cta_text,
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
    const textBody =
      response.text && typeof response.text === 'string' && response.text.trim()
        ? response.text
        : "👋 I'm here to help. How can I assist you?"
    body.text = { body: textBody }
  }

  console.log('📤 Sending WhatsApp message to:', to)
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
