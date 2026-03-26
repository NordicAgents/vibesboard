# Agent Hooks — Implementation Plan

## Context & Use Case

Vibeagent is the **agent registry and execution engine**. Agents are created here, configured with instructions, files, and tools, then exposed to the outside world.

The primary external use case is **agent-to-agent (A2A) communication** — two agents, each running in vibeagent, exchanging messages to accomplish a goal: a negotiation, a compatibility check, a structured interview, a vetting process. The external system (separate service) owns the session lifecycle — it decides who talks to whom, manages turn order, detects when the session ends, and stores the outcome. Vibeagent's job is narrow and clean:

> Accept a message on behalf of a named agent, run the agent, return the reply.

This separation means vibeagent stays stateless with respect to sessions. It does not need to know whether the caller is a human, another agent, or an automated pipeline.

---

## What We Are Building

A **hook** is a persistent, secret-authenticated HTTP endpoint tied to a single agent. Creating a hook gives you:

- A public `hookId` (used as the URL token)
- A `secretKey` (used to authenticate requests — never sent back after creation)

Anyone holding the `secretKey` can POST messages to the agent and receive replies. No Firebase session cookie. No login.

An agent can have **multiple hooks** — one per external integration (e.g. one for the negotiation service, one for a third-party app).

---

## Data Model

### HookDocument

Stored at: `/tenants/{tenantId}/agents/{agentId}/hooks/{hookId}`

```ts
interface HookDocument {
  id: string              // nanoid() — used as the URL token
  agentId: string
  tenantId: string
  name: string            // human label, e.g. "Negotiation Service Hook"
  secretKey: string       // nanoid(32) — hashed on write, compared on request
  active: boolean         // soft disable without deletion
  requestCount: number    // usage counter
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}
```

**Why nanoid for the secret instead of HMAC signing?**
HMAC signing (as used in the referenced notifications project) makes sense for event delivery where the payload integrity needs verification by a third party. Here the pattern is request authentication — the caller proves identity by knowing the secret. A nanoid(32) bearer secret is simpler, equally secure for this use case, and avoids the per-request signing overhead. If payload integrity verification becomes a requirement later, HMAC can be layered on top.

**Why not store the raw secret?**
The secret is stored as a SHA-256 hash. It is shown to the user exactly once at creation time and never returned again. This follows the same pattern as API keys in Stripe, GitHub, etc.

---

## API Surface

### Management endpoints (session-authenticated, agent owner only)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/agents/{id}/hooks` | List all hooks for an agent |
| `POST` | `/api/agents/{id}/hooks` | Create a new hook |
| `PATCH` | `/api/agents/{id}/hooks/{hookId}` | Rename or disable/enable a hook |
| `DELETE` | `/api/agents/{id}/hooks/{hookId}` | Permanently revoke a hook |

**POST /api/agents/{id}/hooks — request body:**
```json
{ "name": "Negotiation Service" }
```

**POST response (secret shown once):**
```json
{
  "id": "hk_abc123",
  "name": "Negotiation Service",
  "secretKey": "hook_secret_example_not_a_real_secret",
  "active": true,
  "createdAt": "2026-03-21T..."
}
```

---

### Hook endpoint (public, secret-authenticated)

```
POST /api/hooks/{hookId}/chat
```

**Headers:**
```
X-Hook-Secret: <secretKey>
Content-Type: application/json
```

**Request body:**
```json
{
  "message": "I can offer $500 for the contract.",
  "externalUserId": "session_abc123",
  "conversationId": "conv_xyz"
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `message` | yes | The message to send to the agent |
| `externalUserId` | recommended | Scopes conversation history to a session. The external system passes a stable ID (e.g. the A2A session ID) so the agent remembers prior context within that session. |
| `conversationId` | optional | Resume a specific conversation thread by ID. If omitted, a new one is created or looked up by `externalUserId`. |

**Response (JSON, non-streaming):**
```json
{
  "reply": "That's below our floor. We need at least $700.",
  "conversationId": "conv_xyz",
  "agentId": "agent_123",
  "hookId": "hk_abc123"
}
```

**Why non-streaming?**
The external system (negotiation orchestrator) needs a complete reply before deciding what to send next. Streaming is optimised for human-facing UIs where perceived latency matters. For A2A turn-based exchanges, a clean JSON response is simpler to implement and consume on both sides.

---

## Request Authentication

On every incoming request to `/api/hooks/{hookId}/chat`:

1. Extract `X-Hook-Secret` header
2. Look up the `HookDocument` by `hookId`
3. Hash the provided secret with SHA-256 and compare to stored hash
4. If mismatch or hook is inactive → `401 Unauthorized`
5. Increment `requestCount` and update `lastUsedAt` (async, non-blocking)

No Firebase session cookie is required or checked.

---

## Conversation Threading

The `externalUserId` field is the key to persistent context across turns.

When the external system initiates an A2A session between Agent A and Agent B, it assigns a stable session ID (e.g. `session_negotiation_001`). Every time it sends a message to Agent A it passes `externalUserId: "session_negotiation_001"`. Same for Agent B. Each agent maintains its own conversation thread scoped to that session ID, so each has full memory of the exchange from its own perspective.

The `ConversationDocument` already has an `externalId` field. The hook endpoint maps `externalUserId` → `externalId` when calling `ensureConversation()`. No schema changes to Firestore are needed for this.

---

## Execution Flow

The hook endpoint reuses the existing `runAgentStream()` runtime but consumes the result as a completed string rather than streaming it:

```
POST /api/hooks/{hookId}/chat
  → validate secret
  → load hook → load agent (via agentId on hook doc)
  → ensureConversation({ externalId: externalUserId })
  → runAgentStream({ agent, messages, onCompletion })
  → collect full completion from stream
  → return { reply, conversationId, agentId, hookId }
```

This means zero changes to the agent runtime, RAG, tools, or conversation storage. The hook endpoint is a thin authentication + adapter layer on top of existing infrastructure.

---

## Files to Create / Modify

```
app/
  api/
    agents/[id]/
      hooks/
        route.ts              ← GET (list), POST (create)
        [hookId]/
          route.ts            ← PATCH (update), DELETE (revoke)
    hooks/
      [hookId]/
        chat/
          route.ts            ← PUBLIC endpoint, X-Hook-Secret auth

lib/
  agents/
    hooks.ts                  ← DB helpers: create, get, list, delete, verify

lib/
  firestore-types.ts          ← Add HookDocument type + Collections.hooks()
```

No changes to:
- `lib/agent/runtime.ts`
- `lib/agents/conversations.ts`
- `lib/firestore-types.ts` (existing conversation/agent schemas)
- Any existing auth or middleware

---

## Alternatives Considered

### Alt 1: HMAC request signing (like the notifications project)
Every request includes a signature computed from `HMAC-SHA256(secret, payload)`. The receiver verifies the signature.

**Rejected for this use case.** HMAC signing is designed for webhook delivery — where a server pushes events to a customer's endpoint and the customer needs to verify the payload wasn't tampered with in transit. Here we are the receiver, not the sender. The caller is the external system we trust (our own A2A orchestrator). A bearer secret in a header is the correct pattern for authenticating API callers. Simpler, just as secure.

---

### Alt 2: Store agents in a separate public registry with their own API keys
Create a top-level `agent_hooks` collection rather than scoping hooks under agents.

**Rejected.** Keeping hooks as a sub-collection under `/tenants/{tenantId}/agents/{agentId}/hooks/` preserves the ownership hierarchy, makes access control straightforward (only the agent owner can manage hooks), and aligns with the existing pattern for other agent sub-collections (conversations, files, whatsapp_connections).

---

### Alt 3: Streaming response from the hook endpoint
Return a streaming text response instead of a JSON response.

**Conditionally useful, not needed for MVP.** A2A exchanges are turn-based — the orchestrator waits for a full reply before forwarding it. A human UI is not involved. Streaming adds complexity (SSE parsing on the orchestrator side) with no benefit. Can be added as a separate endpoint later if needed (e.g. for human-in-the-loop scenarios).

---

### Alt 4: Build A2A session management into vibeagent
Vibeagent tracks which agents are paired, manages turn order, and detects session end.

**Rejected based on stated requirements.** The user explicitly said communications will be handled separately outside vibeagent. Vibeagent is the agent repo — it exposes agents, runs them, and returns results. Session orchestration is the external system's responsibility. This keeps vibeagent focused and avoids coupling two different concerns.

---

### Alt 5: Per-agent public URL (no secret)
Agents already have a public `agentUrl` slug. Expose a public chat endpoint on that URL with no auth.

**Rejected as the sole mechanism.** The `allowAnonymous` flag already controls public access via the UI. For programmatic A2A use, we need a secret so that only the authorised external system can call the agent — not anyone who discovers the agent URL. Hooks are the right layer for machine-to-machine auth.

---

## Implementation Phases

### Phase 1 — Core (implement now)
- `HookDocument` type + `Collections.hooks()` helper in `firestore-types.ts`
- `lib/agents/hooks.ts` — create, list, get by hookId, delete, verify secret
- `POST /api/agents/{id}/hooks` — create hook, return secret once
- `GET /api/agents/{id}/hooks` — list hooks (no secrets in response)
- `PATCH /api/agents/{id}/hooks/{hookId}` — rename, enable/disable
- `DELETE /api/agents/{id}/hooks/{hookId}` — revoke
- `POST /api/hooks/{hookId}/chat` — public endpoint, full implementation

### Phase 2 — Dashboard UI
- Hooks management tab on agent settings page
- Create hook → show secret in a copy-once modal
- List active hooks with usage stats (requestCount, lastUsedAt)
- Revoke button per hook

### Phase 3 — Observability (optional)
- Hook request logs sub-collection for debugging
- Usage analytics per hook

---

## Summary

The hook system is intentionally minimal. It adds a thin authenticated entry point on top of the agent execution infrastructure that already exists. The external system (A2A orchestrator) calls hooks like a regular HTTP API — POST a message, get a reply, maintain conversation context via `externalUserId`. Vibeagent does not need to know anything about sessions, turn order, or outcomes. It just runs agents.
