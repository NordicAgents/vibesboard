# WhatsApp Message API Documentation

## Overview

The WhatsApp Message API allows you to send messages to users via WhatsApp. It supports multiple message types including text, buttons, lists, and flows.

## Endpoints

### 1. Send Message
**Endpoint:** `POST /api/messages/send`

**Description:** Send a WhatsApp message to a user

**Required Environment Variables:**
- `WHATSAPP_PHONE_NUMBER_ID` - Your WhatsApp Phone Number ID
- `WHATSAPP_ACCESS_TOKEN` - Your WhatsApp Access Token

---

## Request Examples

### Text Message

```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "1234567890",
    "message": {
      "text": "Hello! How can I help you?",
      "type": "text"
    }
  }'
```

**Request Body:**
```json
{
  "to": "1234567890",
  "message": {
    "text": "Hello! How can I help you?",
    "type": "text"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "wamid.HBEUGhRiMDoxNDI1NzQwNTQ5MjY1NzU2NzU6MTcyODM4NjM3NDgzODU="
}
```

---

### Button Message

```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "1234567890",
    "message": {
      "text": "Choose an option:",
      "type": "buttons",
      "buttons": ["Yes", "No", "Maybe"]
    }
  }'
```

**Request Body:**
```json
{
  "to": "1234567890",
  "message": {
    "text": "Do you want to proceed?",
    "type": "buttons",
    "buttons": ["Yes", "No", "Maybe"]
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "wamid.HBEUGhRiMDoxNDI1NzQ0NDA0MjI5Mjc2NzU6MTcyODM4NjM3NDgzODU="
}
```

---

### List Message

```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "1234567890",
    "message": {
      "text": "Select from the list below:",
      "type": "list",
      "options": [
        {
          "id": "item_1",
          "title": "Item 1",
          "description": "This is the first item"
        },
        {
          "id": "item_2",
          "title": "Item 2",
          "description": "This is the second item"
        },
        {
          "id": "item_3",
          "title": "Item 3",
          "description": "This is the third item"
        }
      ]
    }
  }'
```

**Request Body:**
```json
{
  "to": "1234567890",
  "message": {
    "text": "Select from the list below:",
    "type": "list",
    "options": [
      {
        "id": "item_1",
        "title": "Item 1",
        "description": "This is the first item"
      },
      {
        "id": "item_2",
        "title": "Item 2",
        "description": "This is the second item"
      }
    ]
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "wamid.HBEUGhRiMDoxNDI1NzQwNTQ5MjY1NzU2NzU6MTcyODM4NjM3NDgzODU="
}
```

---

### Flow Message (Interactive Form)

```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "1234567890",
    "message": {
      "text": "Please fill out the form",
      "type": "flow",
      "flow": {
        "flow_id": "YOUR_FLOW_ID",
        "screen": "home",
        "cta_text": "Open Form",
        "data": {
          "user_id": "123",
          "name": "John"
        },
        "mode": "published"
      }
    }
  }'
```

**Request Body:**
```json
{
  "to": "1234567890",
  "message": {
    "text": "Please fill out the form",
    "type": "flow",
    "flow": {
      "flow_id": "YOUR_FLOW_ID",
      "screen": "home",
      "cta_text": "Open Form",
      "data": {
        "user_id": "123"
      },
      "mode": "published"
    }
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "messageId": "wamid.HBEUGhRiMDoxNDI1NzQ0NDA0MjI5Mjc2NzU6MTcyODM4NjM3NDgzODU="
}
```

---

## Response Codes

| Code | Status | Description |
|------|--------|-------------|
| 200 | OK | Message sent successfully |
| 400 | Bad Request | Invalid request format or WhatsApp API error |
| 401 | Unauthorized | WhatsApp authentication failed (expired token) |
| 500 | Server Error | Missing configuration or other server error |

---

## Error Responses

### Missing Phone Number ID or Access Token
```json
{
  "error": "WhatsApp configuration not found",
  "details": {
    "phoneNumberId": "Missing",
    "accessToken": "Configured"
  }
}
```

### Invalid Request Format
```json
{
  "error": "Invalid request format",
  "details": [
    {
      "field": "to",
      "message": "Recipient phone number is required"
    },
    {
      "field": "message.text",
      "message": "Message text is required"
    }
  ]
}
```

### WhatsApp Authentication Failed
```json
{
  "error": "WhatsApp authentication failed",
  "details": "WHATSAPP_AUTH_EXPIRED: The WhatsApp access token has expired or is invalid."
}
```

### WhatsApp API Error
```json
{
  "error": "WhatsApp API error",
  "details": "WhatsApp API Error: Invalid recipient phone number"
}
```

---

## Field Specifications

### Message Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `text` | Simple text message | `text` |
| `buttons` | Interactive buttons | `text`, `buttons` |
| `list` | Selection list | `text`, `options` |
| `flow` | Interactive form/flow | `text`, `flow` |

### Button Constraints
- Maximum 3 buttons per message
- Maximum 20 characters per button text

### List Constraints
- Maximum 10 items per list
- Title: Maximum 24 characters
- Description: Maximum 72 characters

### Phone Number Format
- Should be in international format without `+` or spaces
- Example: `1234567890` (country code + number)

---

## Usage in Code

### TypeScript Example

```typescript
import { sendWhatsAppMessage } from "@/lib/whatsapp/sender";

// Send a text message
await sendWhatsAppMessage({
  to: "1234567890",
  response: {
    type: "text",
    text: "Hello from VibeAgent!",
  },
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
});

// Send buttons
await sendWhatsAppMessage({
  to: "1234567890",
  response: {
    type: "buttons",
    text: "Choose one:",
    buttons: ["Accept", "Decline"],
  },
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
});
```

---

## Testing

### Get API Information
```bash
curl http://localhost:3000/api/messages/send
```

**Response:**
```json
{
  "message": "WhatsApp Message Sender API",
  "endpoint": "POST /api/messages/send",
  "description": "Send WhatsApp messages to users",
  "usage": {
    "text": { ... },
    "buttons": { ... },
    "list": { ... }
  },
  "requiredEnv": {
    "WHATSAPP_PHONE_NUMBER_ID": "Your WhatsApp Phone Number ID",
    "WHATSAPP_ACCESS_TOKEN": "Your WhatsApp Access Token"
  }
}
```

---

## Integration with Webhook

The webhook handler receives incoming messages at `/api/webhooks`. You can use the message sender to respond to users:

```typescript
// In POST webhook handler
const incomingMessage = entry.changes[0].value.messages[0];

// Process the message...

// Send a response
await sendWhatsAppMessage({
  to: incomingMessage.from,
  response: {
    type: "text",
    text: "Thanks for your message!",
  },
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
});
```

---

## Security Notes

- Always validate the webhook signature (already implemented in `/api/webhooks`)
- Keep your `WHATSAPP_ACCESS_TOKEN` secret
- Never expose tokens in client-side code
- Use environment variables for sensitive data
- Implement rate limiting for production

---

## Troubleshooting

### "Invalid access token"
- Check that your token hasn't expired
- Verify the token is correct in `.env`
- Regenerate token in Facebook App Dashboard if needed

### "Invalid phone number"
- Ensure phone number is in international format
- Remove any `+` or spaces from the number
- Verify the number is registered in WhatsApp Business

### "Message sending timed out"
- Check your internet connection
- Verify WhatsApp API is accessible
- Check Facebook API status

### "Invalid recipient"
- Verify the phone number exists on WhatsApp
- Check that the number isn't blocked
- Ensure the number is in the correct format

---

## API Limits

- Maximum message size: 4,096 characters
- Rate limit: Depends on your WhatsApp Business Account tier
- Button message limit: 3 buttons per message
- List message limit: 10 items per message

---

## References

- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/messages)
- [Message Types](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)
- [Interactive Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#interactive-messages)
