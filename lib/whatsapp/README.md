# WhatsApp Agent Integration

This module enables VibeAgents to communicate with users via WhatsApp.

## Features

- ✅ Phone number to agent mapping with status tracking
- ✅ Automatic introduction messages when connecting
- ✅ Connection management (connect, disconnect, reconnect, reset)
- ✅ Conversation tracking per connection
- ✅ Support for all agent modes (provider/collector)
- ✅ Multi-phone support (one agent, multiple numbers)
- ✅ Connection expiry and lifecycle management

## Quick Start

### 1. Run Database Migration

```bash
# Migrations are in supabase/migrations/
# Run via Supabase CLI or dashboard
```

### 2. Configure Environment Variables

```env
WHATSAPP_PHONE_NUMBER_ID=your_phone_id
WHATSAPP_ACCESS_TOKEN=your_access_token
VERIFY_TOKEN=your_verify_token
```

### 3. Connect Phone Number to Agent

```typescript
// Via API
POST /api/agents/{agentId}/whatsapp/connections
{
  "phoneNumber": "+919400293288",
  "sendIntroImmediately": true
}
```

### 4. User Messages are Automatically Routed

When a user messages the connected WhatsApp number, the webhook automatically:
1. Finds the active connection by phone number
2. Loads the agent configuration
3. Processes the message through VibeAgent runtime
4. Sends formatted response back to WhatsApp

## Architecture

```
User WhatsApp Message
    ↓
Webhook (/api/webhooks POST)
    ↓
findActiveConnection(phoneNumber)
    ↓
Load Agent Config
    ↓
VibeAgent Runtime (OpenAI)
    ↓
Format Response (buttons/lists)
    ↓
Send via WhatsApp API
```

## Database Schema

### `whatsapp_agent_connections`

Stores phone number connections to agents.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| agent_id | UUID | Reference to vibe_agents |
| user_id | UUID | Connection creator |
| phone_number | TEXT | E.164 format (+919400293288) |
| phone_number_normalized | TEXT | Digits only (919400293288) |
| status | TEXT | pending \| active \| disconnected \| expired |
| intro_message_sent_at | TIMESTAMPTZ | When intro was sent |
| last_message_received_at | TIMESTAMPTZ | Last activity |
| total_conversations | INTEGER | Counter |
| connected_at | TIMESTAMPTZ | Activation time |
| disconnected_at | TIMESTAMPTZ | Disconnection time |
| expires_at | TIMESTAMPTZ | Optional expiry |

### `vibe_agent_conversations` (updated)

Added WhatsApp-specific columns:

| Column | Type | Description |
|--------|------|-------------|
| channel | TEXT | 'web' \| 'whatsapp' |
| whatsapp_connection_id | UUID | Reference to connection |
| whatsapp_phone_number | TEXT | Sender phone |
| whatsapp_message_ids | TEXT[] | WhatsApp message IDs |

## API Endpoints

### Connect Phone Number

```
POST /api/agents/{agentId}/whatsapp/connections

Body:
{
  "phoneNumber": "+919400293288",
  "customIntroMessage": "Hi! Welcome...",
  "sendIntroImmediately": true,
  "expiresAt": "2026-12-31T23:59:59Z"
}

Response:
{
  "connection": { ... },
  "introMessageSent": true
}
```

### List Connections

```
GET /api/agents/{agentId}/whatsapp/connections?status=active

Response:
{
  "connections": [ ... ],
  "total": 5
}
```

### Get Connection

```
GET /api/agents/{agentId}/whatsapp/connections/{connectionId}

Response:
{
  "connection": { ... }
}
```

### Disconnect

```
PATCH /api/agents/{agentId}/whatsapp/connections/{connectionId}

Body:
{
  "action": "disconnect",
  "conversationAction": "keep",
  "reason": "User requested"
}

Response:
{
  "connection": { ... },
  "message": "Connection disconnected successfully"
}
```

### Reconnect

```
PATCH /api/agents/{agentId}/whatsapp/connections/{connectionId}

Body:
{
  "action": "reconnect",
  "sendIntroMessage": true
}

Response:
{
  "connection": { ... },
  "message": "Connection reconnected successfully"
}
```

### Reset Connection

```
PATCH /api/agents/{agentId}/whatsapp/connections/{connectionId}

Body:
{
  "action": "reset"
}

Response:
{
  "message": "Connection reset successfully. All conversations closed."
}
```

### Resend Introduction

```
PATCH /api/agents/{agentId}/whatsapp/connections/{connectionId}

Body:
{
  "action": "resend_intro"
}

Response:
{
  "message": "Introduction message resent successfully"
}
```

### Delete Connection

```
DELETE /api/agents/{agentId}/whatsapp/connections/{connectionId}

Response:
{
  "message": "Connection deleted successfully"
}
```

## Library Functions

### Connection Management

```typescript
import {
  createConnection,
  findActiveConnection,
  updateConnection,
  disconnectConnection,
  listAgentConnections,
  resetConnection,
} from "@/lib/whatsapp/connections";

// Create connection
const connection = await createConnection(
  {
    agent_id: "agent-uuid",
    phone_number: "+919400293288",
    custom_intro_message: "Welcome!",
  },
  userId
);

// Find active connection
const connection = await findActiveConnection("+919400293288");

// List all connections for agent
const connections = await listAgentConnections("agent-uuid", "active");

// Disconnect
await disconnectConnection("connection-uuid", "User requested");

// Reset (close all conversations)
await resetConnection("connection-uuid");
```

### Introduction Messages

```typescript
import {
  sendIntroductionMessage,
  buildIntroMessage,
  buildIntroButtons,
} from "@/lib/whatsapp/intro-message";

// Send intro
const sent = await sendIntroductionMessage(connection, agent);

// Build custom intro
const message = buildIntroMessage(agent, customText);
const buttons = buildIntroButtons(agent);
```

### Phone Number Utilities

```typescript
import {
  normalizePhoneNumber,
  validatePhoneNumber,
} from "@/lib/whatsapp/connections";

const normalized = normalizePhoneNumber("+91 9400293288"); // "919400293288"
const isValid = validatePhoneNumber("+919400293288"); // true
```

## Types

```typescript
import type {
  WhatsAppAgentConnection,
  WhatsAppConnectionWithAgent,
  CreateConnectionParams,
  UpdateConnectionParams,
  WhatsAppConnectionStatus,
} from "@/lib/whatsapp/types";
```

## Status Lifecycle

```
pending → active → disconnected
   ↓         ↓
   └─────→ expired

pending:      Connection created, intro not sent yet
active:       Intro sent, accepting messages
disconnected: Manually disconnected by user
expired:      Auto-expired based on expires_at
```

## Introduction Message Format

**Collector Mode:**
```
👋 Hi! I'm **Feedback Agent**.

Hi! I'd love to collect your feedback.

I'd love to collect your feedback and hear your thoughts. Feel free to message me anytime!

[Get Started] [Learn More] [Not Now]
```

**Provider Mode:**
```
👋 Hi! I'm **Support Agent**.

How can I help you today?

I'm here to answer your questions and provide assistance. Feel free to message me anytime!

[Ask Question] [Learn More] [Maybe Later]
```

## Error Handling

All API endpoints return standard error responses:

```json
{
  "error": "Error message",
  "details": { ... }  // For validation errors
}
```

Common status codes:
- `200` - Success
- `201` - Created
- `400` - Bad request / validation error
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `500` - Internal server error

## Security

- **Row Level Security (RLS)**: Enabled on all tables
- **User Isolation**: Users can only manage connections for their own agents
- **Phone Validation**: E.164 format required
- **Duplicate Prevention**: One agent per phone number
- **Cascade Deletion**: Deleting agent removes all connections

## Next Steps

1. **Webhook Integration**: Update `/api/webhooks` to use `findActiveConnection()`
2. **UI Components**: Build agent settings UI for connection management
3. **Testing**: End-to-end test with real WhatsApp number
4. **Monitoring**: Add analytics for connection activity
5. **Cron Jobs**: Schedule `expireOldConnections()` to run daily

## Example Usage Flow

```typescript
// 1. User creates agent via UI

// 2. User connects WhatsApp number
const response = await fetch(`/api/agents/${agentId}/whatsapp/connections`, {
  method: "POST",
  body: JSON.stringify({
    phoneNumber: "+919400293288",
    sendIntroImmediately: true,
  }),
});

// 3. System sends intro message to user
// 4. User replies on WhatsApp
// 5. Webhook routes to agent automatically
// 6. Agent processes via VibeAgent runtime
// 7. Response sent back to user
```

## Troubleshooting

**Connection not activating:**
- Check WhatsApp credentials in .env
- Verify phone number format (E.164)
- Check intro message logs for errors

**Messages not routing:**
- Verify connection status is 'active'
- Check phone number normalization
- Verify webhook is receiving requests

**Intro not sending:**
- Check WhatsApp API token validity
- Verify phone number ID is correct
- Check rate limits (1,000 messages/day)

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify database connection
3. Test API endpoints with curl/Postman
4. Review WhatsApp API documentation
