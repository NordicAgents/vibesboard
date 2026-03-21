# Agent Hooks — Usage Guide

Hooks expose any vibeagent agent to external systems via a secret-authenticated HTTP endpoint. The external system (your orchestrator, another agent, a queue worker) sends a message and gets the agent's reply back — no Firebase session required.

---

## Step 1 — Create a Hook

In the vibeagent dashboard:

1. Open an agent → **Settings** (configure panel)
2. Scroll to the **Hooks** section
3. Click **New Hook**, give it a label (e.g. `"Negotiation Service"`)
4. Copy the **Secret Key** — it is shown exactly once and cannot be retrieved again
5. Note the **Hook ID** — this goes in every request URL

---

## Step 2 — Choose Your Mode

Three modes are available depending on how your system wants to interact:

| Mode | Endpoint | Returns | Use when |
|------|----------|---------|----------|
| Sync | `POST /api/hooks/{hookId}/chat` | Full JSON reply | A2A turn-by-turn, simple request/response |
| Stream | `POST /api/hooks/{hookId}/stream` | SSE token stream | Human watching the exchange live |
| Async | `POST /api/hooks/{hookId}/async` | 202 + jobId | Long agents, queues, fire-and-forget |

All three authenticate via the `X-Hook-Secret` request header.

---

## Mode A — Sync

Send a message, wait for the full reply.

**Request**
```http
POST /api/hooks/{hookId}/chat
X-Hook-Secret: YOUR_SECRET_KEY
Content-Type: application/json
```
```json
{
  "message": "I can offer $500 for the contract.",
  "externalUserId": "session_negotiation_001",
  "conversationId": "conv_xyz"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `message` | yes | The message to send to the agent |
| `externalUserId` | recommended | Stable session ID — scopes conversation memory |
| `conversationId` | optional | Resume a specific existing conversation |

**Response**
```json
{
  "reply": "That's below our floor. Minimum is $700.",
  "conversationId": "conv_xyz",
  "agentId": "agent_123",
  "hookId": "hk_abc123"
}
```

---

## Mode B — Streaming (SSE)

Returns `text/event-stream`. Tokens arrive as they are generated.

**Request**
```http
POST /api/hooks/{hookId}/stream
X-Hook-Secret: YOUR_SECRET_KEY
Content-Type: application/json
```
```json
{
  "message": "Summarise the negotiation so far.",
  "externalUserId": "session_001"
}
```

**Response headers**
```
Content-Type: text/event-stream
x-conversation-id: conv_xyz
x-agent-id: agent_123
```

**SSE event format**
```
data: That's below\n\n
data:  our floor.\n\n
data: [DONE] {"conversationId":"conv_xyz","agentId":"agent_123","hookId":"hk_abc"}\n\n
```

- Every `data:` line is a token chunk
- `[DONE]` signals the end and carries final metadata
- `[ERROR]` signals a failure with a `{"message":"..."}` body

**Node.js example**
```js
const res = await fetch('/api/hooks/hk_abc123/stream', {
  method: 'POST',
  headers: {
    'X-Hook-Secret': 'YOUR_SECRET_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'Hello', externalUserId: 'session_001' })
})

const reader = res.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  for (const line of decoder.decode(value).split('\n\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)

    if (payload.startsWith('[DONE]')) {
      const meta = JSON.parse(payload.slice(6))
      console.log('conversationId:', meta.conversationId)
      break
    }
    if (payload.startsWith('[ERROR]')) {
      const err = JSON.parse(payload.slice(7))
      throw new Error(err.message)
    }

    process.stdout.write(payload) // stream token to your UI
  }
}
```

---

## Mode C — Async (fire-and-forget)

Returns `202 Accepted` immediately. The agent runs in the background and POSTs the reply to your `callbackUrl` when done.

**Request**
```http
POST /api/hooks/{hookId}/async
X-Hook-Secret: YOUR_SECRET_KEY
Content-Type: application/json
```
```json
{
  "message": "Evaluate this candidate profile against the job requirements.",
  "callbackUrl": "https://your-service.com/webhook/reply",
  "externalUserId": "session_001",
  "conversationId": "conv_xyz"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `message` | yes | The message to send to the agent |
| `callbackUrl` | yes | Where vibeagent POSTs the reply when done |
| `externalUserId` | recommended | Stable session ID for conversation memory |
| `conversationId` | optional | Resume a specific conversation |

**Immediate response (202)**
```json
{
  "jobId": "job_xyz",
  "status": "pending",
  "agentId": "agent_123",
  "hookId": "hk_abc123"
}
```

**Callback payload** (POSTed to your `callbackUrl` when the agent finishes)
```json
{
  "jobId": "job_xyz",
  "hookId": "hk_abc123",
  "agentId": "agent_123",
  "status": "completed",
  "reply": "The candidate is a strong match for the role.",
  "conversationId": "conv_xyz"
}
```

On failure:
```json
{
  "jobId": "job_xyz",
  "status": "failed",
  "error": "Agent not found",
  "conversationId": null
}
```

Delivery is retried up to 3 times with exponential back-off (1s, 2s, 4s).

### Verifying the callback

Every callback includes an `X-Hook-Signature` header. Verify it to confirm the request came from vibeagent and was not tampered with:

```js
import { createHmac } from 'crypto'

function verifyCallback(req) {
  const sig = req.headers['x-hook-signature']
  const body = JSON.stringify(req.body)
  const expected = createHmac('sha256', YOUR_SECRET_KEY)
    .update(body)
    .digest('hex')

  if (sig !== expected) {
    return res.status(401).send('Invalid signature')
  }
}
```

### Polling instead of waiting for callback

```http
GET /api/hooks/{hookId}/jobs/{jobId}
X-Hook-Secret: YOUR_SECRET_KEY
```

Response:
```json
{
  "jobId": "job_xyz",
  "status": "running",
  "callbackAttempts": 0,
  "createdAt": "2026-03-21T10:00:00.000Z",
  "startedAt": "2026-03-21T10:00:01.000Z"
}
```

`status` values: `pending` → `running` → `completed` | `failed`

---

## Conversation Memory

Pass a consistent `externalUserId` (e.g. your session/negotiation ID) across all turns with the same agent. The agent remembers the full conversation history within that session.

```
Turn 1: { message: "I offer $500",              externalUserId: "session_001" }
Turn 2: { message: "What if I add a 2yr deal?", externalUserId: "session_001" }
         ↑ agent remembers the $500 offer from turn 1
```

For A2A negotiations, the external orchestrator assigns one session ID per negotiation and passes it to both agents. Each agent maintains its own conversation thread scoped to that session.

---

## Managing Hooks

### Via dashboard

Agent settings → **Hooks** card:
- **New Hook** — creates hook, shows secret once
- Toggle the power icon to enable/disable
- Trash icon to permanently revoke

### Via API (session auth required)

```http
# List hooks for an agent
GET /api/agents/{agentId}/hooks

# Create a hook
POST /api/agents/{agentId}/hooks
Content-Type: application/json
{ "name": "Negotiation Service" }

# Rename or disable
PATCH /api/agents/{agentId}/hooks/{hookId}
Content-Type: application/json
{ "status": "inactive" }

# Delete
DELETE /api/agents/{agentId}/hooks/{hookId}
```

---

## Security

- Secret keys are stored as SHA-256 hashes — vibeagent cannot retrieve the plaintext
- Secrets are compared using timing-safe equality to prevent timing attacks
- Disabled hooks return `401` immediately without running the agent
- `callbackUrl` must be a public HTTPS/HTTP URL — localhost, private IPs (10.x, 172.16-31.x, 192.168.x), and link-local addresses are blocked
- Callback payloads are signed with HMAC-SHA256 — always verify before trusting
