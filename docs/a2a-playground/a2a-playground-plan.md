# A2A Playground — Implementation Plan

## Context

Tenants on vibeagent can have many agents (e.g., 100), each with a unique personality. The A2A Playground lets users make their agent **discoverable** so other users' agents can approach them. Two agents have a natural semi-structured conversation, then a **system Matcher agent** scores compatibility and decides whether to connect the two people.

Primary use case: dating/friendship matching. But the same infra supports trade, hiring, selling — any intention where agents represent people and need to evaluate each other through conversation.

**POC constraints**: Fetch-to-self worker model (extractable to Cloud Functions later). Firestore as blackboard + state store. Same-tenant only. Auto-create hooks on blackboard registration.

---

## Architecture Overview

```
  Tenant with 100 agents, each with a personality
         │
         ├── Agent A (user opts in) ──→ registers on Blackboard (discoverable)
         ├── Agent B (user opts in) ──→ registers on Blackboard (discoverable)
         └── Agent C (initiator)    ──→ searches Blackboard with an intention
                                           │
                                    Discovers Agent A & B
                                           │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                    Worker: C talks to A          Worker: C talks to B
                    (hook-to-hook, semi-          (hook-to-hook, semi-
                     structured conversation)      structured conversation)
                              │                           │
                              ▼                           ▼
                    System Matcher scores         System Matcher scores
                    C↔A transcript: 85/100        C↔B transcript: 42/100
                              │                           │
                              ▼                           ▼
                    "Connect these two!"          "Not a match"
                              │
                              ▼
                    User C sees: "Agent A is a strong match (85/100)"
                    User A sees: "Agent C wants to connect with you"
```

**Execution model**: `/negotiate` fires `fetch()` to `/api/playground/worker/[negotiationId]` per match. Each negotiation = independent serverless invocation. Business logic in portable `lib/playground/negotiator.ts` (extractable to Cloud Functions later).

---

## 1. Firestore Data Model

### New Collections

**`/tenants/{tenantId}/playground_sessions/{sessionId}`** — One session per user intention

| Field | Type | Notes |
|-------|------|-------|
| id, tenantId, userId | string | Standard |
| initiatorAgentId | string | User's agent doing the searching |
| intention | string | Free-text: "find someone who loves hiking and indie music" |
| intentionTags | string[] | Extracted keywords for discovery |
| status | enum | `configuring → discovering → conversing → scoring → completed / failed / cancelled` |
| config.maxDiscoveryResults | number | Default 10 |
| config.maxConversationTurns | number | Default 10 |
| config.conversationTimeoutMs | number | Default 120000 |
| config.maxConcurrentConversations | number | Default 3 |
| config.matchThreshold | number | Default 70 (out of 100) |
| reverseSessionId | string? | If triggered by reverse interest |

**`/tenants/{tenantId}/playground_blackboard/{entryId}`** — Agent discovery registry

| Field | Type | Notes |
|-------|------|-------|
| agentId, agentName, tenantId | string | Which agent |
| hookId | string | Auto-created hook for A2A |
| hookSecret | string | Encrypted — for internal initiator calls only |
| profileSummary | string | Free-text: what this agent/person is about |
| profileTags | string[] | Keywords for matching |
| status | enum | `active / inactive / busy` |
| metadata | Record | Structured data (interests, location, preferences) |

**`/tenants/{tenantId}/playground_sessions/{sessionId}/conversations/{conversationId}`** — One per agent pair

| Field | Type | Notes |
|-------|------|-------|
| initiatorAgentId | string | The approaching agent |
| responderAgentId | string | The discovered agent |
| responderHookId | string | Hook to call |
| status | enum | `pending → active → completed → scored / timeout / error` |
| currentTurn | number | Incremented per round-trip |
| maxTurns | number | From session config |
| chatConversationId | string | Links to standard vibeagent conversation doc |
| responderInterest | boolean | Responder flagged initiator as interesting |
| matchScore | number? | 0-100, set by Matcher |
| matchVerdict | string? | `strong_match / possible_match / no_match` |
| matchSummary | string? | Matcher's explanation |
| completedAt, scoredAt | string? | Timestamps |

**`/tenants/{tenantId}/playground_sessions/{sessionId}/messages/{messageId}`** — Message log for UI

| Field | Type | Notes |
|-------|------|-------|
| conversationId | string | Which conversation |
| fromAgentId, toAgentId | string | Sender/receiver |
| role | enum | `initiator / responder / system / matcher` |
| content | string | The message text |
| turn | number | For ordering |
| createdAt | string | Timestamp |

---

## 2. State Machines

**Session**: `configuring → discovering → conversing → scoring → completed / failed / cancelled`

**Conversation**: `pending → active → completed → scored / timeout / error`

Note the new `scoring` phase — after all conversations complete, the Matcher evaluates each transcript.

---

## 3. Semi-Structured Conversation

Agents chat naturally based on their personality, but the sidecar prompts them to organically cover key topics. This gives the Matcher structured signal without making the conversation feel robotic.

**Initiator sidecar prompt injection**:
```
You are having a conversation to get to know the other person.
Be yourself — use your personality and style.
Naturally try to explore these topics during the conversation:
- What they're passionate about
- What they're looking for
- Shared interests or values
- Any dealbreakers

You have {remainingTurns} turns left. When you feel you've learned enough
or it's your last turn, say [DONE] to end the conversation gracefully.
```

**Responder sidecar prompt injection** (injected via hook's conversation context):
```
Someone is getting to know you. Be yourself — respond naturally.
Share about yourself when asked, and ask them questions too.
If you find them genuinely interesting for YOUR purposes, include
[INTERESTED] at the very end of your message (after a newline).
```

**Sidecar parses**:
- `[DONE]` → initiator wants to end → conversation status → `completed`
- `[INTERESTED]` → stripped from display, sets `responderInterest = true`
- Turn limit reached → inject "This is your last exchange. Wrap up naturally." → then `completed`

---

## 4. System Matcher Agent

A tenant-level system agent with a fixed scoring prompt. Runs after each conversation completes.

**Matcher prompt**:
```
You are an impartial compatibility evaluator.

Below is a conversation transcript between two agents representing two people.

Initiator's intention: "{intention}"
Initiator's profile: "{initiatorInstructions}"
Responder's profile: "{responderProfileSummary}"

Transcript:
{transcript}

Evaluate their compatibility. Consider:
1. Shared interests and values
2. Communication chemistry
3. Alignment with the initiator's stated intention
4. Any red flags or dealbreakers

Respond in this exact JSON format:
{
  "score": <0-100>,
  "verdict": "strong_match" | "possible_match" | "no_match",
  "summary": "<2-3 sentence explanation>"
}
```

**Implementation**: Single LLM call (not a full agent invocation — no tools/RAG needed). Uses `openai.chat.completions.create()` directly with `response_format: { type: "json_object" }`.

**Cost**: One cheap LLM call per completed conversation. For 10 conversations, that's 10 calls total for scoring.

---

## 5. Communication Flow

```
/negotiate route
    │
    ├──fetch()──→ Worker (Conversation 1: C↔A)
    │               │
    │               ├─ runAgentStream(C) → "Hi! I love hiking..."
    │               ├─ POST /api/hooks/{A.hookId}/chat → A replies naturally
    │               ├─ log messages to Firestore
    │               ├─ ... turns repeat ...
    │               ├─ [DONE] detected or maxTurns → status: completed
    │               └─ call Matcher → score: 85, verdict: strong_match
    │
    ├──fetch()──→ Worker (Conversation 2: C↔B)
    │               └─ same flow → score: 42, verdict: no_match
    │
    └── returns 202 Accepted immediately
```

### Reverse Interest
After a conversation completes where `responderInterest === true`:
1. System auto-creates a new session where responder becomes initiator
2. Skips discovery — target is the original initiator
3. Goes straight to conversation phase
4. Matcher scores the reverse conversation independently

---

## 6. Sidecar Pattern

**`lib/playground/sidecar.ts`** — Lightweight wrapper, no rigid protocol

- `buildInitiatorContext()` — adds semi-structured exploration prompt to agent's system message
- `buildResponderContext()` — adds "be yourself + [INTERESTED] signal" to responder context
- `parseResponse()` — detects `[DONE]`, `[INTERESTED]`, strips control signals from display text
- `checkTermination()` — turn limit + wall-clock timeout
- `injectLastTurnPrompt()` — at final turn: "Wrap up naturally"

---

## 7. Concurrency Control

- **Session state transitions**: Firestore transaction with expected-state check
- **Conversation turn locking**: Transaction checks `currentTurn === expectedTurn`
- **Parallel conversations**: Each worker runs independently, isolated by conversationId
- **Session completion detection**: After each conversation scores, worker checks if ALL conversations for the session are done → transitions session to `completed`

---

## 8. Livelock Prevention

| Mechanism | Implementation |
|-----------|---------------|
| **Max turns** | `currentTurn >= maxTurns` → inject final turn prompt → then complete |
| **Wall-clock timeout** | `now - startedAt > timeoutMs` → force complete |
| **[DONE] signal** | Initiator can end conversation early if satisfied |
| **Dead conversation cleanup** | On session load, complete any stuck > 2x timeout |
| **HTTP timeout** | 30s fetch timeout per hook call |
| **No self-conversation** | Filter initiator from discovery |

---

## 9. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/playground/sessions` | POST, GET | Create / list sessions |
| `/api/playground/sessions/[sessionId]` | GET, DELETE | Detail / cancel |
| `/api/playground/sessions/[sessionId]/discover` | POST | Trigger discovery against blackboard |
| `/api/playground/sessions/[sessionId]/start` | POST | Fire-and-forget: spawns worker per conversation via `fetch()`, returns 202 |
| `/api/playground/sessions/[sessionId]/cancel` | POST | Cancel all active conversations + session |
| `/api/playground/sessions/[sessionId]/conversations/[convId]` | GET | Conversation detail + messages + score |
| **`/api/playground/worker/[conversationId]`** | **POST** | **Internal worker — runs one conversation loop + Matcher scoring. Auth via `X-Internal-Secret`.** |
| `/api/playground/blackboard` | GET, POST | List / register (auto-creates hook) |
| `/api/playground/blackboard/[entryId]` | PATCH, DELETE | Update / remove (deletes hook) |

---

## 10. UI Components

| File | Purpose |
|------|---------|
| `app/playground/page.tsx` | Session list + "New Session" |
| `app/playground/[sessionId]/page.tsx` | Live session view |
| `components/playground/session-list.tsx` | Session cards with status |
| `components/playground/create-session.tsx` | Select agent, type intention, configure limits |
| `components/playground/session-view.tsx` | Left: intention + config. Center: conversation tabs. Right: match results/scores |
| `components/playground/conversation-chat.tsx` | Real-time chat via `onSnapshot` on messages |
| `components/playground/match-results.tsx` | Scored results: agent name, score, verdict, summary. Sorted by score. |
| `components/playground/discovery-panel.tsx` | Discovered agents before conversations start |
| `components/playground/status-badge.tsx` | Reusable status badge |
| `components/playground/blackboard-manager.tsx` | Register agent on blackboard (in agent settings) |

---

## 11. Implementation Order

### Phase 1: Data Model + Core Library
1. **`lib/firestore-types.ts`** — New types + Collection path helpers
2. **`lib/playground/blackboard.ts`** — Register (+ auto-create hook), discover, update, remove
3. **`lib/playground/sidecar.ts`** — Context building, signal parsing, termination checks
4. **`lib/playground/matcher.ts`** — System Matcher: takes transcript → returns score/verdict/summary
5. **`lib/playground/negotiator.ts`** — The conversation loop: initiator thinks → calls responder hook → logs → checks termination → on complete calls Matcher
6. **`lib/playground/orchestrator.ts`** — Session state machine: create, discover, spawn workers, detect completion, handle reverse interest
7. **`lib/playground/tag-extractor.ts`** — Keyword extraction from intention/profile text

### Phase 2: API Routes
8. **Worker route** (`/api/playground/worker/[conversationId]`) — internal, runs one conversation + scoring
9. Session routes (CRUD + discover + start + cancel)
10. Blackboard routes (CRUD with auto-hook)

### Phase 3: UI
11. Playground pages (list + session detail)
12. Components (create form, session view, conversation chat, match results, blackboard manager)
13. Real-time listeners (`onSnapshot` on messages)

### Phase 4: Polish
14. Firestore indexes + security rules
15. Conversation prompt templates (`lib/playground/prompts.ts`)
16. `INTERNAL_WORKER_SECRET` env var

---

## 12. Key Reuse Points

| Existing Code | Reuse For |
|---------------|-----------|
| `lib/agents/hooks.ts` → `createHook()` | Auto-create hooks on blackboard registration |
| `lib/agent/runtime.ts` → `runAgentStream` | Run initiator agent locally |
| `/api/hooks/[hookId]/chat` endpoint | Responder receives messages — zero new code on responder side |
| `lib/agents/conversations.ts` | Conversation persistence |
| `lib/openai.ts` | OpenAI client for Matcher scoring call |

---

## 13. Scaling Migration Path (Post-POC)

| POC (Now) | Scale (Later) | Change |
|-----------|---------------|--------|
| `fetch()` to self | Firestore `onCreate` trigger on conversation doc | Replace fetch with just writing the doc |
| Next.js worker route | Cloud Function importing same `negotiator.ts` | Delete route, deploy function |
| `negotiator.ts` module | Same module, unchanged | Nothing |
| System Matcher (single prompt) | Configurable Matcher agent per tenant | Add matcher agent selection to session config |
| Same-tenant discovery | Cross-tenant global blackboard | Collection group query + permission layer |

---

## 14. Verification

1. **Register 2-3 test agents** on blackboard with different personalities — verify hooks auto-created
2. **Create a session** with a dating/friendship intention — verify discovery returns matching agents
3. **Start conversations** — verify agents chat naturally, semi-structured topics covered
4. **[DONE] signal** — verify initiator can end early, conversation completes
5. **[INTERESTED] signal** — verify detected, reverse session queued after completion
6. **Matcher scoring** — verify transcript evaluated, score/verdict/summary returned
7. **Match threshold** — verify only scores >= threshold shown as matches
8. **Livelock** — set maxTurns=3, verify conversation wraps up at limit
9. **Real-time UI** — open session view, verify messages + scores appear live
10. **Cancellation** — cancel mid-conversation, verify cleanup
