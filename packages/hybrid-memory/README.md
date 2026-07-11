# hybrid-engram

**Extended engram with a full hybrid memory pipeline for AI agents.**

An intersection of [simple-engram](https://www.npmjs.com/package/simple-engram) (extraction, decay, merge, events) and a hybrid memory architecture (cross-conversation reconciliation, presence classes, approval-gated mutations). Designed to be framework-agnostic, storage-agnostic, and plug-and-play.

---

## Why not just simple-engram?

simple-engram is great at single-conversation extraction and weighted recall. Two problems it can't solve:

**The similarity-relevance gap** — if a user says "always answer in two sentences or less", simple-engram stores it. But when they later ask "summarize recent incidents", the cosine distance between those two phrases is near zero, so the preference is never retrieved. The agent writes a 10-paragraph summary.

**No cross-conversation awareness** — reflective capture runs on one conversation at a time. It will never notice that a user has asked about subnet details in 4 out of 5 incident triage sessions, and therefore never produce the memory "user wants incident reports to include the affected subnet."

hybrid-engram solves both by adding:
- **Omnipresent presence class** — bypasses search entirely, always injected
- **Stage 2 reconciliation** — compares observations across multiple conversations to detect patterns

Everything else — memory decay, near-duplicate merge, event emission, lifecycle hooks, stats, export — is delegated to simple-engram.

---

## Architecture

```
CONVERSATION
  │
  ├─ engine.ingest()          ← embed every message (indiscriminate capture)
  │                              → hybrid_message_embeddings
  │
  │  [conversation goes idle after cooldownMs]
  │
  ├─ engine.observe()         ← Stage 1: LLM extracts statement+evidence pairs
  │                              → hybrid_observations  (status: new)
  │
  ├─ engine.reconcile()       ← Stage 2: cross-conversation comparison
  │                              sibling observations + message evidence → pattern detection
  │                              → hybrid_mutations     (status: pending)
  │
  ├─ engine.approve()         ← admin approves mutation
  │                              → hybrid_memories      (durable, searchable)
  │
  └─ engine.recall()          ← before each response: inject memory context
       omnipresent:   always injected
       pattern:       injected when trigger terms appear in the message
       on-demand:     vector search, returned as tool-retrievable
       → contextBlock (string ready to prepend to system prompt)
```

### The four tables

| Table | What it stores | Lifetime |
|---|---|---|
| `hybrid_message_embeddings` | Every message, embedded — raw evidence base | Pruned after N days |
| `hybrid_observations` | Statement+evidence pairs extracted from conversations | Audit trail |
| `hybrid_mutations` | Proposed memory changes pending approval | Audit trail |
| `hybrid_memories` | Approved long-term memories, injected at runtime | Decays via importance score |

---

## Installation

```bash
npm install hybrid-engram simple-engram
# or
bun add hybrid-engram simple-engram
```

For the Postgres adapter (optional):
```bash
npm install hybrid-engram drizzle-orm
```

---

## Quick start

```ts
import Engram from 'simple-engram'
import { HybridEngram } from 'hybrid-engram'
import { InMemoryHybridStore } from 'hybrid-engram/stores/in-memory'

// Minimal setup — in-memory store, bring your own LLM and embedder
const engine = new HybridEngram({
  store: new InMemoryHybridStore(),
  llm: {
    complete: async (prompt) => {
      // call your LLM here
      return myLLMClient.complete(prompt)
    },
  },
  embedder: {
    embed: async (text) => myEmbeddingClient.embed(text),
    embedBatch: async (texts) => myEmbeddingClient.embedBatch(texts),
  },
  base: new Engram(),   // optional — delegates forget/merge/stats/events
})
```

With OpenAI adapters:
```ts
import { HybridEngram } from 'hybrid-engram'
import { PostgresHybridStore } from 'hybrid-engram/adapters/postgres'
import { OpenAILLMProvider, OpenAIEmbedder } from 'hybrid-engram/adapters/openai'

const engine = new HybridEngram({
  store: new PostgresHybridStore({ db: myDrizzleClient }),
  llm: new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY }),
  embedder: new OpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY }),
  options: {
    cooldownMs: 2 * 60 * 60 * 1000,   // 2 hours before Stage 1 runs
    autoApprove: false,                 // require admin approval
  },
})
```

---

## Usage in your AI handler

```ts
// ① Before generating a response — inject memory context
const { contextBlock } = await engine.recall(userMessage, {
  conversationId: 'conv_abc',
  scopeId: 'org_acmecorp',       // org / tenant / agent
  subScopeId: 'user_sarah_123',  // user / contact / member (null = org-wide)
})

const systemPrompt = `You are a helpful assistant.\n\n[MEMORY]\n${contextBlock}`

// ② After the response — fire and forget
engine.ingest(messageId, messageContent, ctx).catch(console.error)
```

---

## Background jobs

Run these from your cron scheduler:

```ts
// Every hour — Stage 1: extract observations from idle conversations
const result = await engine.observe()
// [{ conversationId: 'conv_abc', extracted: 3 }, ...]

// Every hour — Stage 2: reconcile observations into proposed mutations
const summary = await engine.reconcile()
// { processed: 12, mutated: 2, deferred: 5, discarded: 5 }
```

---

## Approval queue

```ts
// List pending mutations for an org admin to review
const pending = await engine.getPending({ scopeId: 'org_acmecorp' })
// [
//   {
//     id: 'mut_001',
//     mutation: { operation: 'add', memory: { key: '/contact/preferences/style', ... } },
//     approver: 'org-admin',
//     status: 'pending',
//   }
// ]

// Admin approves → memory is written and embedded
await engine.approve('mut_001')

// Admin rejects → mutation marked rejected, no memory written
await engine.reject('mut_002')
```

Auto-approve mode (skip the queue — useful for dev/testing):
```ts
const engine = new HybridEngram({ ..., options: { autoApprove: true } })
```

---

## Explicit capture

The agent can propose a memory directly (e.g. via a tool call):

```ts
const pending = await engine.propose(
  "User always wants incident reports to include the affected subnet",
  ctx,
)
// Returns a PendingMutation — goes to approval queue unless autoApprove: true
```

---

## Memory tree format

Memories are stored with slash-delimited keys and serialized as a tree for injection:

```
[/preferences/style] Be concise. Use numbered steps, no long paragraphs.
[/contact/history]
  [/incidents] User asks about subnet details in most triage sessions ...
  [/billing] Recurring questions about Pro plan upgrade ...
[/runbooks] [... 3 more here]
```

- **Omnipresent** entries show their full body (always injected)
- **Pattern** and **on-demand** entries show only the description with `...` (body retrievable)
- Deep subtrees are collapsed to `[... N more here]`

---

## Presence classes

| Class | When injected | Best for |
|---|---|---|
| `omnipresent` | Every conversation, always | Communication preferences, user profile, standing instructions |
| `pattern` | When trigger terms appear in the message | Domain knowledge, procedures, definitions |
| `on-demand` | Only via explicit tool call / agent-retrieve | Long docs, runbooks, reference materials |

Setting a memory to `omnipresent` is how you break the **similarity-relevance gap** — communication preferences are injected regardless of what the user asks about.

---

## Scope model

```ts
// org-scoped: applies to all contacts for this org/agent
{
  scope: 'org',
  scopeId: 'acmecorp',     // your org/tenant/agent id
  subScopeId: null,
}

// member-scoped: applies only to one specific user/contact
{
  scope: 'member',
  scopeId: 'acmecorp',
  subScopeId: 'sarah_123', // your user/contact/member id
}
```

Map your domain freely:

| Your domain | `scopeId` | `subScopeId` |
|---|---|---|
| Multi-tenant SaaS | `tenantId` | `contactId` |
| Single-org app | `agentId` | `userId` |
| Personal assistant | `userId` | `sessionId` |

---

## Bringing your own storage

Implement `HybridStore` for any database:

```ts
import type { HybridStore } from 'hybrid-engram'

class MyCustomStore implements HybridStore {
  async saveMemory(memory) { ... }
  async getMemory(id) { ... }
  async listMemories(filter) { ... }
  async updateMemory(id, patch) { ... }
  async deleteMemory(id) { ... }
  async searchMemories(embedding, k, filter) { ... }

  async saveObservation(obs) { ... }
  async updateObservationStatus(id, status) { ... }
  async searchObservations(embedding, k, scopeId) { ... }
  async getPendingObservations(scopeId?, limit?) { ... }
  async getIdleConversations(cooldownMs, scopeId?) { ... }
  async markConversationProcessed(conversationId) { ... }

  async saveMessageEmbedding(messageId, content, embedding, ctx) { ... }
  async listMessagesByConversation(conversationId) { ... }
  async searchMessages(embedding, k, ctx) { ... }

  async saveMutation(mutation) { ... }
  async getMutation(id) { ... }
  async listMutations(filter) { ... }
  async updateMutationStatus(id, status, resolvedAt) { ... }
}
```

---

## Inherited from simple-engram (via `base`)

When you pass a `base: new Engram(...)` instance, these methods are delegated:

| Method | What it does |
|---|---|
| `engine.remember(messages)` | Extract memories from a conversation (single-pass LLM) |
| `engine.forget()` | Prune expired / low-importance memories (Ebbinghaus decay) |
| `engine.merge()` | Consolidate near-duplicates (cosine similarity > 0.85) |
| `engine.stats()` | Aggregated metrics by category / namespace |
| `engine.export(format)` | JSON / Markdown / CSV export |
| `engine.on(event, fn)` | Listen to stored / recalled / forgotten / merged events |

---

## Configuration

```ts
const engine = new HybridEngram({
  store, llm, embedder,
  options: {
    // From simple-engram
    surpriseThreshold: 0.3,       // minimum novelty to store a memory
    decayHalfLifeDays: 30,        // Ebbinghaus decay half-life
    maxRetentionDays: 90,         // hard expiry
    maxMemories: 10_000,          // capacity cap
    defaultK: 5,                  // memories returned by vector search

    // Hybrid additions
    cooldownMs: 7_200_000,        // idle threshold before Stage 1 (default: 2h)
    observationNeighbors: 5,      // sibling observations fetched in Stage 2 (k_o)
    messageNeighbors: 10,         // message chunks fetched in Stage 2 (k_m)
    maxOmnipresentTokens: 500,    // cap on always-injected text
    autoApprove: false,           // skip approval queue
  },
})
```

---

## DB schema (Postgres adapter)

Five tables created automatically via Drizzle migrations:

```sql
hybrid_memories              -- durable long-term memories (pgvector)
hybrid_observations          -- raw observations from Stage 1 (pgvector)
hybrid_message_embeddings    -- per-message embeddings for Stage 2 evidence (pgvector)
hybrid_processed_conversations -- tracks which convs have had Stage 1 run
hybrid_mutations             -- pending approval queue
```

---

## Relationship to simple-engram

hybrid-engram is **not a fork** — it wraps simple-engram as an optional peer dependency and delegates the intersection features. You can use both in the same app:

```
simple-engram         → single-conversation extraction, decay, merge, events
hybrid-engram         → cross-conversation reconciliation, presence classes, approval queue
```

simple-engram handles the per-conversation intelligence. hybrid-engram handles the cross-conversation patterns and the retrieval architecture that avoids the similarity-relevance gap.
