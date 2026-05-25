# Firestore → Postgres Phase 4: Conversations & Conversation-RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate conversation + message data access, handoff/refs/feedback/close/auto-summarize, and conversation embeddings from Firestore to Postgres, keeping staging fully working (chat history, handoff, feedback, Ask-AI) at every slice boundary.

**Architecture:** DB logic lives in package helpers (`packages/agents/src/conversations.ts`, `auto-summarize.ts`; `packages/ai/src/conversation-rag.ts`, `embeddings.ts`), each rewritten to call Drizzle directly. Every helper takes an **optional `db` last param defaulting to `getMigrateDb()`** so it is `withTestDb`-testable. Conversations live in the `conversations` table; messages move from an embedded array to rows in the `messages` table. Handoff "refs" are **DERIVED** from `conversations.handoffChain` (no `conversation_refs` table). Feedback moves to the `conversation_feedback` table. Conversation embeddings move to the unified `embeddings` table (`sourceType = 'conversation_chunk'`, `sourceId = conversationId`), following the `rag-store.ts` pattern. Routes/pages stay thin: auth + validate + call helper + map.

**Tech Stack:** Drizzle ORM (`postgres-js`), `@vibesboard/adapter-postgres` (`getMigrateDb`/schema/`test-utils`), `uuidv7`, pgvector (dim 1536, cosine), `node --test --experimental-strip-types --conditions react-server`.

---

## Key model decisions (read before starting)

1. **Messages: separate table, delete+reinsert per update.** Firestore embedded only `{id, role, content}` via `serializeMessages`. Postgres `messages` has `(id, tenantId, conversationId, role, content, toolCalls, metadata, createdAt)`. `updateConversationMessages` is the only writer of the full set and always receives the **entire** message array (the chat route accumulates and re-sends all messages). Reconciliation strategy: **delete all rows for the conversation, then bulk-insert the incoming set in array order**, inside one transaction. Ordering is preserved by inserting `uuidv7()` ids in array order and reading back `ORDER BY created_at, id`. We persist `id` (reuse the message's existing id if it is a valid uuid, else `uuidv7()`), `role`, `content`; `toolCalls`/`metadata` are left null (the legacy serialize dropped them — out of scope to add now).

2. **`rowToConversation` builds `VibeAgentConversation` including `messages`.** A conversation row maps to the legacy doc shape (ISO-string timestamps via `.toISOString()`); `messages` is populated from a joined/explicit message-rows fetch mapped to `Message`. `mapConversationDoc` in `agents/db.ts` stays as the Firestore-shape mapper used only by remaining Firestore code; new code uses `rowToConversation`. Both produce the identical `VibeAgentConversation` interface so callers are unchanged.

3. **Handoff refs are DERIVED, no `conversation_refs` table.** Verified against the only two ref consumers: (a) `apps/web/app/agents/[id]/page.tsx` lists "conversations handed off to this agent" then loads each source conversation; (b) chat route `updateConversationRef` bumps `responseCount`/`lastMessageAt` on a target agent's ref. Both are satisfiable from `conversations.handoffChain` + `responseCounts` + `updatedAt` since a single Postgres `conversations` table is queryable by any agent (Firestore needed per-agent ref docs only because conversations were siloed per-agent collection). Derivation query for "refs to agent X": `conversations WHERE tenantId=$t AND handoffChain @> '[{"toAgentId":"X"}]' ORDER BY updatedAt DESC`. `responseCount` for the ref = `responseCounts[X]`. Therefore `createConversationRef`/`updateConversationRef`/`listConversationRefs` become **no-ops / derivations**: `updateConversationRef` is dropped (response counts already maintained by `updateConversationMessages(respondingAgentId)`), `listConversationRefs` is reimplemented as `listHandoffConversationsForAgent`.

4. **Feedback → `conversation_feedback` table.** Legacy stored an embedded `feedback` object. `VibeAgentConversation.feedback` is a single object; we store one row per submission and `rowToConversation` attaches the latest by `created_at desc`.

5. **`sync-embeddings` / `lastEmbeddingsSyncAt`** is updated via the existing agents Postgres path. `getAgentById` already returns Postgres rows (PR #174); we add `setAgentEmbeddingsSyncedAt(agentId, when, db)` to `packages/agents/src/db.ts`.

6. **DEFERRED to Phase 5 (do NOT migrate here):** `apps/web/app/api/tenants/[id]/whatsapp-inbox/...` and `.../instagram-inbox/...` conversation routes, and `packages/channel-*` conversation helpers. These remain on Firestore until Phase 5. The `agents/[id]/conversations/reply` + `ask` + `webhooks/chatwoot` routes call conversation helpers too — `ask` and `cid` and chat are in scope; `reply` (human reply to chatwoot) is Phase 5, leave it on Firestore (it imports `getConversation` — keep that import resolvable by keeping `getConversation` exported with the same signature).

---

## File map

| File | Slice | Change |
|---|---|---|
| `packages/agents/src/conversations.ts` | 4a/4b | Rewrite all helpers to Postgres + `db` param |
| `packages/agents/src/db.ts` | 4a/4c | Add `rowToConversation`, `messageRowToMessage`, `setAgentEmbeddingsSyncedAt` |
| `packages/agents/src/__tests__/conversations.test.ts` | 4a/4b | Create |
| `packages/agents/src/auto-summarize.ts` | 4b | Rewrite to Postgres + `db` param |
| `packages/agents/src/__tests__/auto-summarize.test.ts` | 4b | Create |
| `packages/ai/src/embeddings.ts` | 4c | Rewrite `upsertConversationEmbeddings` to `embeddings` table |
| `packages/ai/src/conversation-rag.ts` | 4c | Rewrite vector/fallback to Postgres |
| `packages/ai/src/__tests__/conversation-rag.test.ts` | 4c | Create |
| `apps/web/app/actions.ts` | 4a | `getAgentConversations` → Postgres helper |
| `apps/web/app/agents/[id]/page.tsx` | 4a/4b | conversations + derived handoff refs via helpers |
| `apps/web/app/agents/[id]/conversations/[cid]/page.tsx` | 4a/4b | `getConversation` (+ derived source lookup) |
| `apps/web/app/api/agents/[id]/conversations/route.ts` | 4a | already calls helper; verify |
| `apps/web/app/api/agents/[id]/conversations/[cid]/route.ts` | 4b | helper calls (get/handoff/resume/delete) |
| `apps/web/app/api/agents/[id]/conversations/[cid]/close/route.ts` | 4b | Postgres via helper |
| `apps/web/app/api/agents/[id]/conversations/refresh-summaries/route.ts` | 4b | Postgres via helper |
| `apps/web/app/api/agents/[id]/conversations/sync-embeddings/route.ts` | 4c | Postgres via helpers |
| `apps/web/app/api/public/agents/[agentId]/conversations/[cid]/feedback/route.ts` | 4b | `conversation_feedback` table |
| `apps/web/app/api/public/agents/[agentId]/chat/route.ts` | 4a/4b | persistence imports unchanged (helpers swap underneath) |
| `apps/web/app/api/agents/[id]/chat/route.ts` | 4a/4b | same |

---

## Slice 4a — Core conversation + message CRUD + read consumers

**Outcome:** Chatting with an agent persists the conversation and its messages to Postgres; the message history is visible in the sidebar, the agent page, and the conversation detail page. Handoff/feedback/embeddings still flow through their (temporarily) existing code paths but the storage of conversations+messages is Postgres.

### Task 4a.1: `messageRowToMessage` + `rowToConversation` mappers

**Files:**
- Modify: `packages/agents/src/db.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { rowToConversation, messageRowToMessage } from '../db.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0,8)}`, instructions: 'instructions ok' })
  return { tenantId: t, agentId: a, userId: u }
}

describe('conversation mappers', () => {
  test('rowToConversation maps row + messages to VibeAgentConversation', () => {
    const now = new Date('2026-05-24T00:00:00.000Z')
    const conv = rowToConversation(
      { id: 'c1', agentId: 'a1', userId: 'u1', externalId: null, summary: null,
        closedAt: null, handedOff: false, handoffChain: null, responseCounts: null,
        summaryGeneratedAt: null, summaryResponseCount: null, createdAt: now, updatedAt: now } as any,
      [{ id: 'm1', role: 'user', content: 'hi', createdAt: now } as any],
      null,
    )
    assert.equal(conv.id, 'c1')
    assert.equal(conv.createdAt, '2026-05-24T00:00:00.000Z')
    assert.equal(conv.messages.length, 1)
    assert.equal(conv.messages[0].content, 'hi')
    assert.equal(conv.handedOff, false)
  })

  test('messageRowToMessage strips db-only fields', () => {
    const m = messageRowToMessage({ id: 'm1', role: 'assistant', content: 'yo', createdAt: new Date() } as any)
    assert.deepEqual(Object.keys(m).sort(), ['content', 'id', 'role'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/agents && npm test`
Expected: FAIL — `rowToConversation`/`messageRowToMessage` not exported.

- [ ] **Step 3: Implement the mappers in `packages/agents/src/db.ts`**

Add near `mapConversationRow`:

```ts
import type { Conversation, Message as MessageRow, ConversationFeedbackRow } from '@vibesboard/adapter-postgres/schema'

export const messageRowToMessage = (row: MessageRow): Message => ({
  id: row.id,
  role: row.role as Message['role'],
  content: row.content,
})

export const rowToConversation = (
  row: Conversation,
  messageRows: MessageRow[],
  feedback: ConversationFeedbackRow | null,
): VibeAgentConversation => ({
  id: row.id,
  agentId: row.agentId,
  userId: row.userId,
  externalId: row.externalId,
  summary: row.summary ?? null,
  messages: messageRows.map(messageRowToMessage),
  closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  handedOff: row.handedOff ?? false,
  handoffChain: Array.isArray(row.handoffChain) ? row.handoffChain : undefined,
  responseCounts: row.responseCounts ?? undefined,
  summaryGeneratedAt: row.summaryGeneratedAt ? row.summaryGeneratedAt.toISOString() : null,
  summaryResponseCount: row.summaryResponseCount ?? undefined,
  feedback: feedback
    ? { rating: feedback.rating, comment: feedback.comment ?? undefined, createdAt: feedback.createdAt.toISOString() }
    : undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
```

- [ ] **Step 4: Run to verify the mapper tests pass**

Run: `cd packages/agents && npm test`
Expected: PASS (the two mapper tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/db.ts packages/agents/src/__tests__/conversations.test.ts
git commit -m "feat(agents): add rowToConversation + messageRowToMessage Postgres mappers"
```

### Task 4a.2: `ensureConversation` + `getConversation` on Postgres

**Files:**
- Modify: `packages/agents/src/conversations.ts` (rewrite header + these two functions)
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test (append to the describe block)**

```ts
import { ensureConversation, getConversation } from '../conversations.ts'

describe('ensureConversation / getConversation (pg)', () => {
  test('creates a conversation with initial messages and reads it back', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const conv = await ensureConversation({
        tenantId, agentId, userId,
        initialMessages: [{ id: 'm1', role: 'user', content: 'hello' }],
      }, adminDb)
      assert.ok(conv.id)
      assert.equal(conv.messages.length, 1)
      assert.equal(conv.messages[0].content, 'hello')

      const fetched = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(fetched?.id, conv.id)
      assert.equal(fetched?.messages[0].content, 'hello')
    })
  })

  test('ensureConversation returns existing by id (idempotent) and enforces agent ownership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const first = await ensureConversation({ tenantId, agentId, externalId: 'ext-1' }, adminDb)
      const again = await ensureConversation({ tenantId, agentId, conversationId: first.id }, adminDb)
      assert.equal(again.id, first.id)
    })
  })

  test('ensureConversation finds existing by externalId when no id given', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const first = await ensureConversation({ tenantId, agentId, externalId: 'ext-9' }, adminDb)
      const found = await ensureConversation({ tenantId, agentId, externalId: 'ext-9' }, adminDb)
      assert.equal(found.id, first.id)
    })
  })

  test('getConversation returns null for missing id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      assert.equal(await getConversation(tenantId, agentId, randomUUID(), adminDb), null)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/agents && npm test`
Expected: FAIL — functions still hit Firestore / wrong signature (no `db` param).

- [ ] **Step 3: Rewrite the file header + `ensureConversation` + `getConversation`**

Replace the imports at the top of `packages/agents/src/conversations.ts`:

```ts
import { type Message, type VibeAgentConversation } from '@vibesboard/contracts'
import { and, eq, desc, sql, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  conversations as conversationsTable,
  messages as messagesTable,
  conversationFeedback as conversationFeedbackTable,
} from '@vibesboard/adapter-postgres/schema'
import { rowToConversation } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** Load a conversation row + its ordered messages + latest feedback, mapped. */
async function loadConversation(
  db: Db, tenantId: string, agentId: string | null, id: string,
): Promise<VibeAgentConversation | null> {
  const [row] = await db.select().from(conversationsTable)
    .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, id)))
    .limit(1)
  if (!row) return null
  if (agentId && row.agentId !== agentId) return null
  const msgs = await db.select().from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const [fb] = await db.select().from(conversationFeedbackTable)
    .where(eq(conversationFeedbackTable.conversationId, id))
    .orderBy(desc(conversationFeedbackTable.createdAt)).limit(1)
  return rowToConversation(row, msgs, fb ?? null)
}

async function insertMessages(
  db: Db, tenantId: string, conversationId: string, messages: Message[],
) {
  if (!messages.length) return
  await db.insert(messagesTable).values(messages.map((m) => ({
    id: isUuid(m.id) ? m.id : uuidv7(),
    tenantId, conversationId,
    role: m.role as 'user' | 'assistant' | 'system' | 'tool',
    content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
  })))
}
```

Replace `ensureConversation`:

```ts
interface ConversationIdentifier { conversationId?: string; userId?: string | null; externalId?: string | null }
interface EnsureConversationArgs extends ConversationIdentifier {
  tenantId: string; agentId: string; initialMessages?: Message[]
}

export async function ensureConversation(
  { tenantId, agentId, conversationId, userId, externalId, initialMessages = [] }: EnsureConversationArgs,
  db: Db = getMigrateDb(),
): Promise<VibeAgentConversation> {
  if (conversationId) {
    const existing = await loadConversation(db, tenantId, null, conversationId)
    if (existing) {
      if (existing.agentId !== agentId) throw new Error('Conversation does not belong to agent')
      if (userId && existing.userId && existing.userId !== userId) throw new Error('Unauthorized conversation access')
      if (externalId && existing.externalId && existing.externalId !== externalId) throw new Error('Unauthorized conversation access')
      return existing
    }
  }
  if (!conversationId && externalId) {
    const [row] = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId), eq(conversationsTable.externalId, externalId)))
      .limit(1)
    if (row) return (await loadConversation(db, tenantId, agentId, row.id))!
  }
  const id = conversationId && isUuid(conversationId) ? conversationId : uuidv7()
  return db.transaction(async (tx) => {
    await tx.insert(conversationsTable).values({
      id, tenantId, agentId, userId: userId ?? null, externalId: externalId ?? null,
    })
    await insertMessages(tx as unknown as Db, tenantId, id, initialMessages)
    return (await loadConversation(tx as unknown as Db, tenantId, agentId, id))!
  })
}
```

Replace `getConversation`:

```ts
export async function getConversation(
  tenantId: string, agentId: string, id: string, db: Db = getMigrateDb(),
): Promise<VibeAgentConversation | null> {
  return loadConversation(db, tenantId, agentId, id)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/agents && npm test`
Expected: PASS (ensure/get tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/conversations.ts packages/agents/src/__tests__/conversations.test.ts
git commit -m "feat(agents): ensureConversation + getConversation on Postgres"
```

### Task 4a.3: `updateConversationMessages` (delete+reinsert) + `listAgentConversations`

**Files:**
- Modify: `packages/agents/src/conversations.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { updateConversationMessages, listAgentConversations } from '../conversations.ts'

describe('updateConversationMessages / listAgentConversations (pg)', () => {
  test('replaces the full message set (delete+reinsert) and preserves order', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation({ tenantId, agentId,
        initialMessages: [{ id: 'm1', role: 'user', content: 'one' }] }, adminDb)
      await updateConversationMessages({ tenantId, agentId, conversationId: conv.id,
        messages: [
          { id: 'm1', role: 'user', content: 'one' },
          { id: 'm2', role: 'assistant', content: 'two' },
          { id: 'm3', role: 'user', content: 'three' },
        ], respondingAgentId: agentId }, adminDb)
      const after = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.deepEqual(after!.messages.map(m => m.content), ['one', 'two', 'three'])
      assert.equal(after!.responseCounts?.[agentId], 1)
    })
  })

  test('listAgentConversations returns newest first, filters by externalId', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const a = await ensureConversation({ tenantId, agentId, externalId: 'x1' }, adminDb)
      const b = await ensureConversation({ tenantId, agentId, externalId: 'x2' }, adminDb)
      await updateConversationMessages({ tenantId, agentId, conversationId: a.id, messages: [{ id: 'z', role: 'user', content: 'bump' }] }, adminDb)
      const all = await listAgentConversations(tenantId, agentId, undefined, adminDb)
      assert.equal(all.length, 2)
      assert.equal(all[0].id, a.id) // a was updated last → newest
      const filtered = await listAgentConversations(tenantId, agentId, { externalId: 'x2' }, adminDb)
      assert.equal(filtered.length, 1); assert.equal(filtered[0].id, b.id)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/agents && npm test`
Expected: FAIL — `updateConversationMessages`/`listAgentConversations` not Postgres yet.

- [ ] **Step 3: Rewrite both functions**

```ts
interface UpdateConversationArgs {
  tenantId: string; agentId: string; conversationId: string
  messages: Message[]; summary?: string | null; respondingAgentId?: string
}

export async function updateConversationMessages(
  { tenantId, agentId, conversationId, messages, summary, respondingAgentId }: UpdateConversationArgs,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId))
    await insertMessages(tx as unknown as Db, tenantId, conversationId, messages)

    const patch: Partial<typeof conversationsTable.$inferInsert> = { updatedAt: new Date() }
    if (summary !== undefined) patch.summary = summary
    await tx.update(conversationsTable).set(patch)
      .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, conversationId)))

    if (respondingAgentId) {
      // Increment responseCounts[respondingAgentId] in jsonb atomically.
      await tx.update(conversationsTable).set({
        responseCounts: sql`jsonb_set(
          coalesce(${conversationsTable.responseCounts}, '{}'::jsonb),
          ${`{${respondingAgentId}}`}::text[],
          to_jsonb(coalesce((${conversationsTable.responseCounts} ->> ${respondingAgentId})::int, 0) + 1)
        )`,
      }).where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, conversationId)))
    }
  })
}

export async function listAgentConversations(
  tenantId: string, agentId: string,
  filter?: { userId?: string; externalId?: string },
  db: Db = getMigrateDb(),
): Promise<VibeAgentConversation[]> {
  const conds = [eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId)]
  if (filter?.userId) conds.push(eq(conversationsTable.userId, filter.userId))
  if (filter?.externalId) conds.push(eq(conversationsTable.externalId, filter.externalId))
  const rows = await db.select().from(conversationsTable).where(and(...conds))
    .orderBy(desc(conversationsTable.updatedAt))
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = await db.select().from(messagesTable)
    .where(inArray(messagesTable.conversationId, ids))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) { const arr = byConv.get(m.conversationId) ?? []; arr.push(m); byConv.set(m.conversationId, arr) }
  return rows.map((r) => rowToConversation(r, byConv.get(r.id) ?? [], null))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/agents && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/conversations.ts packages/agents/src/__tests__/conversations.test.ts
git commit -m "feat(agents): updateConversationMessages (delete+reinsert) + listAgentConversations on Postgres"
```

### Task 4a.4: `getAgentConversations` server action → Postgres

**Files:**
- Modify: `apps/web/app/actions.ts:95-140`

- [ ] **Step 1: Read current implementation**

Run: `grep -n "getAgentConversations" apps/web/app/actions.ts` and read lines 95–140. It loops agents in a tenant (Firestore `agentsSnapshot`) then loops each agent's conversations.

- [ ] **Step 2: Replace the Firestore body with helper calls**

Use the already-Postgres `getAgentNamesByTenant` (or `getAgentsForTenant`) from `@vibesboard/agents/server` to enumerate agents, then `listAgentConversations(tenantId, agentId)` per agent (filtered to `userId === session.user.id` for the sidebar):

```ts
import { getAgentsForTenant } from '@vibesboard/agents/server'
import { listAgentConversations } from '@vibesboard/agents/conversations'
// ...
const agentsList = await getAgentsForTenant(activeTenantId)
const grouped = await Promise.all(agentsList.map(async (a) => {
  const convs = await listAgentConversations(activeTenantId, a.id, { userId })
  return { agentId: a.id, agentName: a.name, conversations: convs }
}))
```

Remove the `adminDb`/`Collections.conversations` usage in this function only (the `Collections.chats` block above is a different domain — leave it).

- [ ] **Step 3: Build the web app**

Run: `cd apps/web && npm run build` (or `npx tsc --noEmit`)
Expected: typechecks; no `adminDb` reference remains in `getAgentConversations`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/actions.ts
git commit -m "feat(web): getAgentConversations sidebar reads from Postgres"
```

### Task 4a.5: Agent page + cid page + conversations route reads → helpers

**Files:**
- Modify: `apps/web/app/agents/[id]/page.tsx:49-85`
- Modify: `apps/web/app/agents/[id]/conversations/[cid]/page.tsx:46-81`
- Verify: `apps/web/app/api/agents/[id]/conversations/route.ts` (already calls `listAgentConversations` — only the new `db`-defaulted signature matters; no change needed)

- [ ] **Step 1: Agent page — replace the conversations fetch (refs deferred to 4b)**

In `page.tsx`, replace the `adminDb.collection(Collections.conversations(...))` block with:

```ts
import { listAgentConversations } from '@vibesboard/agents/conversations'
// ...
conversations = tenantId ? await listAgentConversations(tenantId, agent.id) : []
```

Leave the `handoffConversations` (refs) block as-is for now — it will be migrated in 4b. (It still reads Firestore refs; staging shows no handoff cards until 4b, acceptable mid-slice since refs were always best-effort.)

- [ ] **Step 2: cid page — replace direct doc fetch with `getConversation`**

In `[cid]/page.tsx`, replace the `adminDb.collection(...).doc(cid)` lookup with:

```ts
import { getConversation } from '@vibesboard/agents/conversations'
// ...
const found = await getConversation(tenantId, agent.id, cid)
if (found) { conversation = found; conversationId = found.id; initialMessages = found.messages }
```

Leave the "if not found, check conversation_refs" branch for 4b.

- [ ] **Step 3: Build**

Run: `cd apps/web && npm run build`
Expected: typechecks.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/agents/[id]/page.tsx" "apps/web/app/agents/[id]/conversations/[cid]/page.tsx"
git commit -m "feat(web): agent + conversation-detail pages read conversations from Postgres"
```

### Task 4a.6: Chat persistence wiring (public + authed chat routes)

**Files:**
- Verify: `apps/web/app/api/public/agents/[agentId]/chat/route.ts`
- Verify: `apps/web/app/api/agents/[id]/chat/route.ts`

These routes import `ensureConversation`, `updateConversationMessages`, `getConversation` from `@vibesboard/agents/conversations` — the signatures are **unchanged** (db defaults to `getMigrateDb()`), so they automatically use Postgres. They also call `recordConversationHandoff` and `updateConversationRef` (migrated/dropped in 4b) and `maybeAutoSummarize` (migrated in 4b).

- [ ] **Step 1: Confirm imports resolve and signatures match**

Run: `grep -n "ensureConversation\|updateConversationMessages\|getConversation" "apps/web/app/api/public/agents/[agentId]/chat/route.ts"`
Confirm call sites pass an object arg (no `db`) — matches new signature.

- [ ] **Step 2: Temporarily neutralize 4b-only calls so 4a builds**

`updateConversationRef` and `recordConversationHandoff` are still Firestore in 4a. They remain callable (still exported, still Firestore-backed) until 4b — leave them. `maybeAutoSummarize` is still Firestore — leave it. No code change here; this task is a verification gate.

- [ ] **Step 3: Build**

Run: `cd apps/web && npm run build`
Expected: typechecks.

- [ ] **Step 4: Commit (if any incidental fix needed)**

```bash
git add -A && git commit -m "chore(web): verify chat persistence wired to Postgres conversation helpers"
```

### Slice 4a staging e2e (Chrome)

1. Open an agent's public chat URL; send a message; confirm 200 and a streamed reply.
2. Reload — message history reappears (read from `messages` table).
3. Open the dashboard sidebar (`getAgentConversations`) — the conversation appears under the agent.
4. Open the agent page → conversations tab → the conversation is listed; open it → messages render in order.
5. DB check: `select count(*) from messages where conversation_id = '<cid>'` matches the message count.

---

## Slice 4b — Handoff (derived refs) + feedback + close + auto-summarize + refresh-summaries

### Task 4b.1: handoff state (`isConversationHandedOff`, `markConversationHandedOff`, `resumeConversation`)

**Files:**
- Modify: `packages/agents/src/conversations.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { isConversationHandedOff, markConversationHandedOff, resumeConversation } from '../conversations.ts'

describe('handoff state (pg)', () => {
  test('mark / isHandedOff(byExternalId) / resume', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation({ tenantId, agentId, externalId: 'ext-h' }, adminDb)
      assert.equal(await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb), false)
      await markConversationHandedOff(tenantId, agentId, conv.id, adminDb)
      assert.equal(await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb), true)
      await resumeConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(await isConversationHandedOff(tenantId, agentId, 'ext-h', adminDb), false)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Implement**

```ts
export async function isConversationHandedOff(
  tenantId: string, agentId: string, externalId: string, db: Db = getMigrateDb(),
): Promise<boolean> {
  const [row] = await db.select({ handedOff: conversationsTable.handedOff }).from(conversationsTable)
    .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId), eq(conversationsTable.externalId, externalId)))
    .limit(1)
  return row?.handedOff === true
}

export async function markConversationHandedOff(
  tenantId: string, agentId: string, conversationId: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(conversationsTable).set({ handedOff: true, updatedAt: new Date() })
    .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, conversationId)))
}

export async function resumeConversation(
  tenantId: string, agentId: string, conversationId: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(conversationsTable).set({ handedOff: false, updatedAt: new Date() })
    .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, conversationId)))
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/agents && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/conversations.ts packages/agents/src/__tests__/conversations.test.ts
git commit -m "feat(agents): handoff state on Postgres (mark/resume/isHandedOff)"
```

### Task 4b.2: `recordConversationHandoff` (append chain) + derived `listHandoffConversationsForAgent`; drop ref CRUD

**Files:**
- Modify: `packages/agents/src/conversations.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { recordConversationHandoff, listHandoffConversationsForAgent } from '../conversations.ts'

describe('handoff chain + derived refs (pg)', () => {
  test('recordConversationHandoff appends chain; target agent lists the conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const targetId = randomUUID()
      await adminDb.insert(agents).values({ id: targetId, tenantId, userId, name: 'T', slug: `t-${targetId.slice(0,8)}`, instructions: 'ok ok ok' })
      const conv = await ensureConversation({ tenantId, agentId, externalId: 'ext-x' }, adminDb)

      await recordConversationHandoff(tenantId, agentId, conv.id, {
        fromAgentId: agentId, fromAgentName: 'A', toAgentId: targetId, toAgentName: 'T',
      }, adminDb)

      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(reloaded!.handoffChain?.length, 1)
      assert.equal(reloaded!.handoffChain?.[0].toAgentId, targetId)

      const refs = await listHandoffConversationsForAgent(tenantId, targetId, adminDb)
      assert.equal(refs.length, 1)
      assert.equal(refs[0].id, conv.id)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Implement; delete the Firestore ref-CRUD functions**

```ts
export async function recordConversationHandoff(
  tenantId: string, agentId: string, conversationId: string,
  handoff: { fromAgentId: string; fromAgentName: string; toAgentId: string; toAgentName: string },
  db: Db = getMigrateDb(),
): Promise<void> {
  const entry = { ...handoff, timestamp: new Date().toISOString() }
  await db.update(conversationsTable).set({
    handoffChain: sql`coalesce(${conversationsTable.handoffChain}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`,
    activeAgentId: handoff.toAgentId,
    updatedAt: new Date(),
  }).where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, conversationId)))
}

/** DERIVED refs: conversations whose handoffChain targets this agent. */
export async function listHandoffConversationsForAgent(
  tenantId: string, agentId: string, db: Db = getMigrateDb(), limit = 10,
): Promise<VibeAgentConversation[]> {
  const rows = await db.select().from(conversationsTable)
    .where(and(
      eq(conversationsTable.tenantId, tenantId),
      sql`${conversationsTable.handoffChain} @> ${JSON.stringify([{ toAgentId: agentId }])}::jsonb`,
    ))
    .orderBy(desc(conversationsTable.updatedAt)).limit(limit)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = await db.select().from(messagesTable).where(inArray(messagesTable.conversationId, ids))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) { const arr = byConv.get(m.conversationId) ?? []; arr.push(m); byConv.set(m.conversationId, arr) }
  return rows.map((r) => rowToConversation(r, byConv.get(r.id) ?? [], null))
}
```

Delete `createConversationRef`, `updateConversationRef`, `listConversationRefs` and the `ConversationRefDocument` import. (Response counts are already maintained by `updateConversationMessages(respondingAgentId)`, so the chat route's `updateConversationRef` call becomes redundant — handled in 4b.5.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/agents && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/conversations.ts packages/agents/src/__tests__/conversations.test.ts
git commit -m "feat(agents): handoff chain on Postgres + derived listHandoffConversationsForAgent; drop ref CRUD"
```

### Task 4b.3: `deleteConversation` (cascade messages/feedback; embeddings cleanup)

**Files:**
- Modify: `packages/agents/src/conversations.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { deleteConversation } from '../conversations.ts'
import { messages as messagesTbl } from '@vibesboard/adapter-postgres/schema'

describe('deleteConversation (pg)', () => {
  test('deletes conversation and cascades messages; returns false when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation({ tenantId, agentId, initialMessages: [{ id: 'm1', role: 'user', content: 'x' }] }, adminDb)
      assert.equal(await deleteConversation(tenantId, agentId, conv.id, adminDb), true)
      assert.equal(await getConversation(tenantId, agentId, conv.id, adminDb), null)
      const remaining = await adminDb.select().from(messagesTbl)
      assert.equal(remaining.filter((m: any) => m.conversationId === conv.id).length, 0)
      assert.equal(await deleteConversation(tenantId, agentId, conv.id, adminDb), false)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Implement**

Messages and conversation_feedback FK-cascade on conversation delete (schema `onDelete: 'cascade'`). Conversation embeddings live in the `embeddings` table keyed by `sourceId = conversationId` but do NOT FK to conversations — delete them explicitly.

```ts
import { embeddings as embeddingsTable } from '@vibesboard/adapter-postgres/schema'

export async function deleteConversation(
  tenantId: string, agentId: string, conversationId: string, db: Db = getMigrateDb(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: conversationsTable.id }).from(conversationsTable)
      .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId), eq(conversationsTable.id, conversationId)))
      .limit(1)
    if (!row) return false
    await tx.delete(embeddingsTable).where(and(
      eq(embeddingsTable.tenantId, tenantId),
      eq(embeddingsTable.sourceType, 'conversation_chunk'),
      eq(embeddingsTable.sourceId, conversationId),
    ))
    await tx.delete(conversationsTable).where(eq(conversationsTable.id, conversationId)) // cascades messages + feedback
    return true
  })
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/agents && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/conversations.ts packages/agents/src/__tests__/conversations.test.ts
git commit -m "feat(agents): deleteConversation on Postgres (cascade + embeddings cleanup)"
```

### Task 4b.4: `recordConversationFeedback` helper + feedback route

**Files:**
- Modify: `packages/agents/src/conversations.ts` (add helper)
- Modify: `apps/web/app/api/public/agents/[agentId]/conversations/[cid]/feedback/route.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { recordConversationFeedback } from '../conversations.ts'

describe('feedback (pg)', () => {
  test('records feedback; getConversation surfaces latest', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation({ tenantId, agentId, externalId: 'ext-f' }, adminDb)
      await recordConversationFeedback(tenantId, conv.id, { rating: 'positive', comment: 'great' }, adminDb)
      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.equal(reloaded!.feedback?.rating, 'positive')
      assert.equal(reloaded!.feedback?.comment, 'great')
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Implement helper**

```ts
export async function recordConversationFeedback(
  tenantId: string, conversationId: string,
  feedback: { rating: 'positive' | 'negative'; comment?: string },
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.insert(conversationFeedbackTable).values({
    id: uuidv7(), tenantId, conversationId,
    rating: feedback.rating, comment: feedback.comment?.slice(0, 500) ?? null,
  })
}
```

- [ ] **Step 4: Rewrite the feedback route**

Replace the `adminDb.collection(...).doc(cid).update({ feedback })` block with a call to the helper; keep the existing `getConversation` ownership check and rating validation:

```ts
import { getConversation, recordConversationFeedback } from '@vibesboard/agents/conversations'
// ...after validation...
await recordConversationFeedback(tenantId, cid, { rating: body.rating, comment: body.comment })
return NextResponse.json({ ok: true })
```

Remove the `adminDb` + `Collections` imports from this file.

- [ ] **Step 5: Run tests + build**

Run: `cd packages/agents && npm test` then `cd apps/web && npm run build`
Expected: PASS / typechecks.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/conversations.ts packages/agents/src/__tests__/conversations.test.ts "apps/web/app/api/public/agents/[agentId]/conversations/[cid]/feedback/route.ts"
git commit -m "feat(agents,web): conversation feedback on Postgres"
```

### Task 4b.5: cid route, agent page handoff cards, chat route ref-call cleanup

**Files:**
- Modify: `apps/web/app/api/agents/[id]/conversations/[cid]/route.ts`
- Modify: `apps/web/app/agents/[id]/page.tsx`
- Modify: `apps/web/app/agents/[id]/conversations/[cid]/page.tsx`
- Modify: `apps/web/app/api/public/agents/[agentId]/chat/route.ts`
- Modify: `apps/web/app/api/agents/[id]/chat/route.ts`

- [ ] **Step 1: cid route** — already imports `getConversation`, `markConversationHandedOff`, `resumeConversation`, `deleteConversation` (now Postgres). No signature change; verify build only.

- [ ] **Step 2: Agent page handoff cards** — replace the Firestore `conversationRefs` block with the derived helper:

```ts
import { listHandoffConversationsForAgent } from '@vibesboard/agents/conversations'
// ...
handoffConversations = tenantId ? await listHandoffConversationsForAgent(tenantId, agent.id) : []
```

Remove the `adminDb`/`Collections` imports from `page.tsx`.

- [ ] **Step 3: cid page handoff fallback** — replace the "check conversation_refs then load source conversation" branch with a direct cross-agent lookup (single table): if `getConversation(tenantId, agent.id, cid)` is null, try `getConversation(tenantId, <any-agent>, cid)` by loading without agent filter. Add a thin `getConversationAnyAgent(tenantId, cid, db)` to `conversations.ts` that calls `loadConversation(db, tenantId, null, cid)`; use it here. Remove `adminDb`/`Collections` from this page.

- [ ] **Step 4: chat routes** — remove the now-redundant `updateConversationRef(...)` fire-and-forget call (response counts are maintained by `updateConversationMessages(respondingAgentId)`). Keep `recordConversationHandoff` (now Postgres). Drop the `updateConversationRef` import.

- [ ] **Step 5: Build**

Run: `cd apps/web && npm run build`
Expected: typechecks; no remaining `Collections.conversationRefs` references in these files (`grep -rn conversationRefs apps/web/app/agents apps/web/app/api/agents apps/web/app/api/public/agents/\[agentId\]/chat`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): handoff cards + cid route + chat routes use Postgres derived refs"
```

### Task 4b.6: `maybeAutoSummarize` → Postgres

**Files:**
- Modify: `packages/agents/src/auto-summarize.ts`
- Test: `packages/agents/src/__tests__/auto-summarize.test.ts` (create)

- [ ] **Step 1: Write the failing test (mock the summarizer via injected `db` + a stubbed writer)**

Auto-summarize calls `summarizeConversation` (OpenAI). Test the **DB write path** by passing a precomputed summary through a seam: refactor to accept an optional `summarize` fn defaulting to the real one.

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, conversations } from '@vibesboard/adapter-postgres/schema'
import { maybeAutoSummarize } from '../auto-summarize.ts'

async function seedConv(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID(); const c = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0,8)}`, instructions: 'ok ok ok' })
  await adminDb.insert(conversations).values({ id: c, tenantId: t, agentId: a })
  return { tenantId: t, agentId: a, conversationId: c, adminDb }
}

describe('maybeAutoSummarize (pg)', () => {
  test('writes summary when threshold met', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize({
        tenantId, agentId, conversationId,
        messages: [
          { id: '1', role: 'user', content: 'q1' }, { id: '2', role: 'assistant', content: 'a1' },
          { id: '3', role: 'assistant', content: 'a2' }, { id: '4', role: 'assistant', content: 'a3' },
        ],
      }, { db: adminDb, summarize: async () => 'a summary' })
      const [row] = await adminDb.select().from(conversations)
      assert.equal(row.summary, 'a summary')
      assert.equal(row.summaryResponseCount, 3)
      assert.ok(row.summaryGeneratedAt)
    })
  })

  test('no-op below MIN_RESPONSES_FOR_SUMMARY', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await maybeAutoSummarize({ tenantId, agentId, conversationId,
        messages: [{ id: '1', role: 'assistant', content: 'a1' }] },
        { db: adminDb, summarize: async () => 'unused' })
      const [row] = await adminDb.select().from(conversations)
      assert.equal(row.summary, null)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Rewrite `auto-summarize.ts`**

```ts
import { type Message } from '@vibesboard/contracts'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { conversations as conversationsTable } from '@vibesboard/adapter-postgres/schema'
import { summarizeConversation } from '@vibesboard/ai/summarize'

type Db = PostgresJsDatabase<typeof schema>
const MIN_RESPONSES_FOR_SUMMARY = 3
const RE_SUMMARIZE_DELTA = 5

interface AutoSummarizeArgs {
  tenantId: string; agentId: string; conversationId: string; messages: Message[]
  currentSummary?: string | null; summaryResponseCount?: number; responseCounts?: Record<string, number>
}
interface Deps { db?: Db; summarize?: (m: Message[]) => Promise<string | null> }

export async function maybeAutoSummarize(
  { tenantId, agentId, conversationId, messages, currentSummary, summaryResponseCount, responseCounts }: AutoSummarizeArgs,
  deps: Deps = {},
): Promise<void> {
  const db = deps.db ?? getMigrateDb()
  const summarize = deps.summarize ?? summarizeConversation
  const totalResponses = responseCounts
    ? Object.values(responseCounts).reduce((s, n) => s + n, 0) + 1
    : messages.filter((m) => m.role === 'assistant').length
  if (totalResponses < MIN_RESPONSES_FOR_SUMMARY) return
  if (currentSummary && summaryResponseCount != null && totalResponses - summaryResponseCount < RE_SUMMARIZE_DELTA) return
  const summary = await summarize(messages)
  if (!summary) return
  await db.update(conversationsTable).set({
    summary, summaryGeneratedAt: new Date(), summaryResponseCount: totalResponses,
  }).where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.id, conversationId)))
}
```

- [ ] **Step 4: Update chat-route callers** — both chat routes call `maybeAutoSummarize({...})` with a single object; the new second arg defaults, so no change required. Verify by grep that no caller passes the old positional shape.

- [ ] **Step 5: Run + build**

Run: `cd packages/agents && npm test` then `cd apps/web && npm run build`
Expected: PASS / typechecks.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/auto-summarize.ts packages/agents/src/__tests__/auto-summarize.test.ts
git commit -m "feat(agents): maybeAutoSummarize on Postgres with injectable summarizer"
```

### Task 4b.7: close + refresh-summaries routes → Postgres

**Files:**
- Modify: `apps/web/app/api/agents/[id]/conversations/[cid]/close/route.ts`
- Modify: `apps/web/app/api/agents/[id]/conversations/refresh-summaries/route.ts`
- Modify: `packages/agents/src/conversations.ts` (add `closeConversation`, `listUnsummarizedVisitorConversations`)
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { closeConversation, listUnsummarizedVisitorConversations } from '../conversations.ts'

describe('close + refresh helpers (pg)', () => {
  test('closeConversation sets closedAt + summary', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const conv = await ensureConversation({ tenantId, agentId, externalId: 'e' }, adminDb)
      const res = await closeConversation(tenantId, agentId, conv.id, 'final summary', adminDb)
      assert.equal(res, true)
      const reloaded = await getConversation(tenantId, agentId, conv.id, adminDb)
      assert.ok(reloaded!.closedAt)
      assert.equal(reloaded!.summary, 'final summary')
    })
  })

  test('listUnsummarizedVisitorConversations returns visitor convos without summary', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      await ensureConversation({ tenantId, agentId, externalId: 'v1' }, adminDb)        // visitor, no summary
      await ensureConversation({ tenantId, agentId, userId: randomUUID() }, adminDb)    // owner → excluded
      const rows = await listUnsummarizedVisitorConversations(tenantId, agentId, 20, adminDb)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].externalId, 'v1')
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Implement helpers**

```ts
import { isNotNull, isNull } from 'drizzle-orm'

export async function closeConversation(
  tenantId: string, agentId: string, conversationId: string,
  summary: string | null, db: Db = getMigrateDb(),
): Promise<boolean> {
  const now = new Date()
  const res = await db.update(conversationsTable).set({
    closedAt: now, updatedAt: now,
    ...(summary != null ? { summary, summaryGeneratedAt: now } : {}),
  }).where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId), eq(conversationsTable.id, conversationId)))
    .returning({ id: conversationsTable.id })
  return res.length > 0
}

export async function listUnsummarizedVisitorConversations(
  tenantId: string, agentId: string, limit: number, db: Db = getMigrateDb(),
): Promise<VibeAgentConversation[]> {
  const rows = await db.select().from(conversationsTable)
    .where(and(
      eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId),
      isNotNull(conversationsTable.externalId), isNull(conversationsTable.userId), isNull(conversationsTable.summary),
    ))
    .orderBy(desc(conversationsTable.updatedAt)).limit(limit)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const msgs = await db.select().from(messagesTable).where(inArray(messagesTable.conversationId, ids))
    .orderBy(messagesTable.createdAt, messagesTable.id)
  const byConv = new Map<string, typeof msgs>()
  for (const m of msgs) { const arr = byConv.get(m.conversationId) ?? []; arr.push(m); byConv.set(m.conversationId, arr) }
  return rows.map((r) => rowToConversation(r, byConv.get(r.id) ?? [], null))
}
```

- [ ] **Step 4: Rewrite close route** — replace the Firestore doc read/update with `getConversation` (ownership/summary check) + `closeConversation`:

```ts
import { getConversation, closeConversation } from '@vibesboard/agents/conversations'
// ...
const conversation = await getConversation(agent.tenantId, id, cid)
if (!conversation) return new NextResponse('Not found', { status: 404 })
let summary = conversation.summary ?? null
if (!summary) summary = await summarizeConversation(conversation.messages)
const ok = await closeConversation(agent.tenantId, id, cid, summary)
return NextResponse.json({ ok, summary, closedAt: new Date().toISOString() })
```

- [ ] **Step 5: Rewrite refresh-summaries route** — replace the Firestore query/loop with the helper + `closeConversation`-style summary writes via a per-row update. Use `listUnsummarizedVisitorConversations` then for each compute `summarizeConversation` and persist via a small inline `updateConversationSummary` (reuse `closeConversation` is wrong — it sets closedAt). Add `updateConversationSummary(tenantId, agentId, conversationId, summary, db)`:

```ts
export async function updateConversationSummary(
  tenantId: string, agentId: string, conversationId: string, summary: string, db: Db = getMigrateDb(),
): Promise<void> {
  const now = new Date()
  await db.update(conversationsTable).set({ summary, summaryGeneratedAt: now, updatedAt: now })
    .where(and(eq(conversationsTable.tenantId, tenantId), eq(conversationsTable.agentId, agentId), eq(conversationsTable.id, conversationId)))
}
```

Route body:

```ts
import { listUnsummarizedVisitorConversations, updateConversationSummary } from '@vibesboard/agents/conversations'
// ...
const rows = await listUnsummarizedVisitorConversations(agent.tenantId, agent.id, MAX_REFRESH)
let updated = 0
for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const chunk = rows.slice(i, i + CONCURRENCY)
  const results = await Promise.all(chunk.map(async (c) => {
    const summary = await summarizeConversation(c.messages)
    if (!summary) return false
    await updateConversationSummary(agent.tenantId, agent.id, c.id, summary)
    return true
  }))
  updated += results.filter(Boolean).length
}
return NextResponse.json({ updated })
```

Remove `adminDb`/`Collections`/`mapConversationDoc` imports from both routes.

- [ ] **Step 6: Add `updateConversationSummary` test, run, build**

Run: `cd packages/agents && npm test` then `cd apps/web && npm run build`
Expected: PASS / typechecks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(agents,web): close + refresh-summaries on Postgres"
```

### Slice 4b staging e2e (Chrome)

1. Visitor chat → agent triggers a handoff to a second agent. Confirm `handoff_chain` row appended (`select handoff_chain from conversations where id=...`).
2. Open the **target** agent's page → the handed-off conversation appears under "handoff" cards (derived).
3. Open conversation detail → "Hand off to human" → confirm `handed_off=true`; "Resume" → `handed_off=false`.
4. Submit feedback on a public conversation → row in `conversation_feedback`; conversation detail shows the rating.
5. Close a conversation → `closed_at` + `summary` set; run refresh-summaries → unsummarized visitor convos get summaries.

---

## Slice 4c — Conversation embeddings on the unified `embeddings` table

### Task 4c.1: `upsertConversationEmbeddings` → `embeddings` table

**Files:**
- Modify: `packages/ai/src/embeddings.ts`
- Test: `packages/ai/src/__tests__/conversation-rag.test.ts` (create)

- [ ] **Step 1: Write the failing test (inject embedder + db)**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, conversations, embeddings } from '@vibesboard/adapter-postgres/schema'
import { eq, and } from 'drizzle-orm'
import { upsertConversationEmbeddings } from '../embeddings.ts'

function unitVec(dim: number, hot: number) { const v = new Array(dim).fill(0); v[hot] = 1; return v }

async function seedConv(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID(); const c = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0,8)}`, instructions: 'ok ok ok' })
  await adminDb.insert(conversations).values({ id: c, tenantId: t, agentId: a, externalId: 'visitor' })
  return { tenantId: t, agentId: a, conversationId: c }
}

describe('upsertConversationEmbeddings (pg)', () => {
  test('replaces conversation_chunk rows for the conversation', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      const embed = async (texts: string[]) => texts.map((_, i) => unitVec(1536, i % 1536))
      await upsertConversationEmbeddings({ tenantId, agentId, conversationId,
        messages: [{ id: '1', role: 'user', content: 'hello world' }, { id: '2', role: 'assistant', content: 'hi there' }] },
        { db: adminDb, embed })
      let rows = await adminDb.select().from(embeddings)
        .where(and(eq(embeddings.sourceType, 'conversation_chunk'), eq(embeddings.sourceId, conversationId)))
      assert.equal(rows.length, 2)
      // re-run with fewer messages → replaced, not appended
      await upsertConversationEmbeddings({ tenantId, agentId, conversationId,
        messages: [{ id: '1', role: 'user', content: 'only one' }] }, { db: adminDb, embed })
      rows = await adminDb.select().from(embeddings)
        .where(and(eq(embeddings.sourceType, 'conversation_chunk'), eq(embeddings.sourceId, conversationId)))
      assert.equal(rows.length, 1)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/ai && npm test`

- [ ] **Step 3: Rewrite `upsertConversationEmbeddings`**

Keep `buildConversationChunks`, `chunkText`, `embedTexts` unchanged. Replace the Firestore upsert. Note `embeddings.chunkIndex` must be globally unique per row within a conversation — use a running counter (`messageIndex`/`chunkIndex` no longer have dedicated columns; encode `messageIndex` into content ordering isn't needed for storage, but conversation-rag windowing relies on messageIndex). **Decision:** store the running chunk ordinal as `chunkIndex`, and persist `messageIndex` by embedding it via a `metadata`-free scheme — since the `embeddings` table has no metadata column, store `messageIndex` by reconstructing from `chunkIndex` is impossible. Therefore **persist one embedding row per message** (chunkIndex = message index), concatenating multi-part chunks back is unnecessary: set `chunkIndex = messageIndex` and join multi-part text with the message. Simpler and matches conversation-rag's windowing which only needs `messageIndex`.

```ts
import { and, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { embeddings as embeddingsTable } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

interface UpsertConversationEmbeddingsArgs {
  tenantId: string; agentId: string; conversationId: string; messages: Message[]
}
interface UpsertDeps { db?: Db; embed?: (texts: string[]) => Promise<number[][]> }

export async function upsertConversationEmbeddings(
  { tenantId, conversationId, messages }: UpsertConversationEmbeddingsArgs,
  deps: UpsertDeps = {},
): Promise<void> {
  const db = deps.db ?? getMigrateDb()
  const embed = deps.embed ?? embedTexts
  // One chunk per non-empty message; chunkIndex = message index (windowing key for conversation-rag).
  const indexed = messages
    .map((m, i) => ({ messageIndex: i, content: typeof m.content === 'string' ? m.content.trim() : '' }))
    .filter((c) => c.content)
  await db.transaction(async (tx) => {
    await tx.delete(embeddingsTable).where(and(
      eq(embeddingsTable.tenantId, tenantId),
      eq(embeddingsTable.sourceType, 'conversation_chunk'),
      eq(embeddingsTable.sourceId, conversationId),
    ))
    if (!indexed.length) return
    let vectors: number[][] = []
    try { vectors = await embed(indexed.map((c) => c.content)) }
    catch (e) { console.error('Failed to embed conversation chunks', e); return }
    await tx.insert(embeddingsTable).values(indexed.map((c, i) => ({
      id: uuidv7(), tenantId, sourceType: 'conversation_chunk' as const, sourceId: conversationId,
      chunkIndex: c.messageIndex, content: c.content,
      contentTsv: sql`to_tsvector('english', ${c.content})`,
      embedding: vectors[i],
    })))
  })
}
```

(Drop the `FieldValue`/`adminDb`/`Collections` imports from `embeddings.ts`.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/ai && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/embeddings.ts packages/ai/src/__tests__/conversation-rag.test.ts
git commit -m "feat(ai): upsertConversationEmbeddings on unified embeddings table"
```

### Task 4c.2: `conversation-rag.ts` vector + fallback context on Postgres

**Files:**
- Modify: `packages/ai/src/conversation-rag.ts`
- Test: `packages/ai/src/__tests__/conversation-rag.test.ts`

- [ ] **Step 1: Write the failing test (inject embedder + db)**

```ts
import { buildAskAiConversationContext } from '../conversation-rag.ts'
import { updateConversationMessages } from '@vibesboard/agents/conversations'

describe('buildAskAiConversationContext (pg)', () => {
  test('vector search surfaces the matching conversation window', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, conversationId } = await seedConv(adminDb)
      await updateConversationMessages({ tenantId, agentId, conversationId,
        messages: [
          { id: '1', role: 'user', content: 'how do I reset my password' },
          { id: '2', role: 'assistant', content: 'go to settings then security' },
        ] }, adminDb)
      const embed = async (texts: string[]) => texts.map(() => unitVec(1536, 5))
      await upsertConversationEmbeddings({ tenantId, agentId, conversationId,
        messages: [{ id: '1', role: 'user', content: 'how do I reset my password' },
                   { id: '2', role: 'assistant', content: 'go to settings then security' }] },
        { db: adminDb, embed })
      const res = await buildAskAiConversationContext(
        { tenantId, agentId, question: 'password reset?' },
        { db: adminDb, embed })
      assert.equal(res.usedVectorSearch, true)
      assert.ok(res.context.includes('settings then security'))
      assert.ok(res.sourceCount >= 1)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/ai && npm test`

- [ ] **Step 3: Rewrite `conversation-rag.ts`**

Replace Firestore `findNearest`/doc fetches with Postgres. Add `Deps = { db?: Db; embed?: (t: string[]) => Promise<number[][]> }` to `buildAskAiConversationContext`, `buildVectorContext`, `buildFallbackContext`. Keep all formatting helpers (`renderMessageLines`, `truncate`, windowing constants) unchanged.

Vector search query (cosine, `sourceType='conversation_chunk'`, joined to `conversations` for `externalId`/`updatedAt`/`summary`, scoped by `agentId`):

```ts
import { and, eq, sql, desc } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/sql/functions'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { embeddings, conversations as conversationsTable } from '@vibesboard/adapter-postgres/schema'
import { listAgentConversations, getConversation } from '@vibesboard/agents/conversations'
import { embedTexts } from './embeddings.ts'

type Db = PostgresJsDatabase<typeof schema>
interface Deps { db?: Db; embed?: (t: string[]) => Promise<number[][]> }

// inside buildVectorContext:
const distance = cosineDistance(embeddings.embedding, queryEmbedding)
const hits = await db.select({
    conversationId: embeddings.sourceId, messageIndex: embeddings.chunkIndex, distance: sql<number>`${distance}`,
  }).from(embeddings)
  .innerJoin(conversationsTable, eq(conversationsTable.id, embeddings.sourceId))
  .where(and(
    eq(embeddings.tenantId, tenantId), eq(embeddings.sourceType, 'conversation_chunk'),
    eq(conversationsTable.agentId, agentId),
    ...(contextConversationId ? [eq(embeddings.sourceId, contextConversationId)] : []),
  ))
  .orderBy(distance).limit(MAX_VECTOR_MATCHES)
```

Then dedupe `(conversationId, messageIndex)` exactly as before; load each conversation via `getConversation(tenantId, agentId, cid, db)` (filter to `externalId` set), and run the existing windowing/`renderMessageLines` block. `buildFallbackContext` uses `listAgentConversations(tenantId, agentId, undefined, db)` (or `getConversation` for `contextConversationId`), filters `externalId`, takes the most recent `FALLBACK_CONVERSATIONS`, and renders the last N messages — identical formatting to today. Replace `mapConversationRow` usage with the conversations these helpers already return (`VibeAgentConversation`).

Thread `deps` through: `buildAskAiConversationContext(args, deps = {})` → pass `deps.db ?? getMigrateDb()` and `deps.embed ?? embedTexts` into the two builders.

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/ai && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/conversation-rag.ts packages/ai/src/__tests__/conversation-rag.test.ts
git commit -m "feat(ai): conversation-rag vector + fallback context on Postgres"
```

### Task 4c.3: `setAgentEmbeddingsSyncedAt` + sync-embeddings route → Postgres

**Files:**
- Modify: `packages/agents/src/db.ts` (add `setAgentEmbeddingsSyncedAt`)
- Modify: `apps/web/app/api/agents/[id]/conversations/sync-embeddings/route.ts`
- Test: `packages/agents/src/__tests__/conversations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { setAgentEmbeddingsSyncedAt } from '../db.ts'
import { agents as agentsTbl } from '@vibesboard/adapter-postgres/schema'

describe('setAgentEmbeddingsSyncedAt (pg)', () => {
  test('updates lastEmbeddingsSyncAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seedAgent(adminDb)
      const when = new Date('2026-05-24T12:00:00.000Z')
      await setAgentEmbeddingsSyncedAt(agentId, when, adminDb)
      const [row] = await adminDb.select().from(agentsTbl)
      assert.equal(row.lastEmbeddingsSyncAt?.toISOString(), '2026-05-24T12:00:00.000Z')
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/agents && npm test`

- [ ] **Step 3: Implement in `db.ts`**

```ts
export const setAgentEmbeddingsSyncedAt = async (
  agentId: string, when: Date, db = getMigrateDb(),
): Promise<void> => {
  await db.update(agentsTable).set({ lastEmbeddingsSyncAt: when, updatedAt: when })
    .where(eq(agentsTable.id, agentId))
}
```

(`agentsTable` is already imported as `agents as agentsTable`.)

- [ ] **Step 4: Rewrite the sync-embeddings route**

Replace the Firestore enumeration with `listAgentConversations(agent.tenantId, agent.id)`. Filter visitor (`externalId`) vs non-visitor; for non-visitor convos call `deleteFileEmbeddings`-equivalent for conversations — i.e. delete their `conversation_chunk` embeddings via a new tiny helper `deleteConversationEmbeddings(tenantId, conversationId, db)` in `embeddings.ts` (mirror `deleteFileEmbeddings`). For visitor convos newer than `lastEmbeddingsSyncAt`, call `upsertConversationEmbeddings`. Finally `setAgentEmbeddingsSyncedAt(agent.id, new Date())`.

```ts
import { listAgentConversations } from '@vibesboard/agents/conversations'
import { setAgentEmbeddingsSyncedAt } from '@vibesboard/agents/db'
import { upsertConversationEmbeddings, deleteConversationEmbeddings } from '@vibesboard/ai/embeddings'
// ...
const all = await listAgentConversations(agent.tenantId, agent.id)
const lastSync = agent.lastEmbeddingsSyncAt ? new Date(agent.lastEmbeddingsSyncAt) : null
for (const c of all.filter((c) => !c.externalId)) await deleteConversationEmbeddings(agent.tenantId, c.id)
const toSync = all.filter((c) => c.externalId && (!lastSync || new Date(c.updatedAt).getTime() > lastSync.getTime()))
let synced = 0
await limitConcurrency(toSync, 5, async (c) => {
  await upsertConversationEmbeddings({ tenantId: agent.tenantId, agentId: agent.id, conversationId: c.id, messages: c.messages ?? [] })
  synced += 1
})
const syncTime = new Date()
await setAgentEmbeddingsSyncedAt(agent.id, syncTime)
return NextResponse.json({ synced, lastSync: syncTime.toISOString() })
```

Add to `embeddings.ts`:

```ts
export async function deleteConversationEmbeddings(tenantId: string, conversationId: string, db: Db = getMigrateDb()): Promise<void> {
  await db.delete(embeddingsTable).where(and(
    eq(embeddingsTable.tenantId, tenantId),
    eq(embeddingsTable.sourceType, 'conversation_chunk'),
    eq(embeddingsTable.sourceId, conversationId),
  ))
}
```

Remove `adminDb`/`Collections`/`mapConversationDoc`/`collectionGroup` usage from the route.

- [ ] **Step 5: Run + build**

Run: `cd packages/agents && npm test` and `cd packages/ai && npm test` and `cd apps/web && npm run build`
Expected: PASS / typechecks.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(agents,ai,web): sync-embeddings on Postgres + lastEmbeddingsSyncAt update"
```

### Slice 4c staging e2e (Chrome)

1. As agent owner, open the agent page → click "Sync embeddings" (visible when `hasUnsyncedConversations`). Confirm 200 + `{ synced > 0 }`.
2. DB check: `select count(*) from embeddings where source_type='conversation_chunk'` > 0; `select last_embeddings_sync_at from agents where id=...` is updated.
3. Open the agent's Ask-AI panel → ask a question matching a past visitor conversation → answer cites the conversation (vector path; `usedVectorSearch=true` in logs).
4. Delete a synced conversation → its `conversation_chunk` embeddings are removed (`source_id` count → 0).

---

## Self-Review

**1. Spec coverage (Phase 4 row: `conversations`, `conversationRefs`, `conversationChunks`, `dataLogs`; call-sites `agents/[id]/chat`, `public/.../chat`, `hooks/[hookId]/chat`, `public/.../feedback`, `agents/conversations`, `ai/conversation-rag`, `sync-embeddings`).**
- `conversations` table + `messages` table: 4a.1–4a.6. ✔
- `conversationRefs`: DERIVED in 4b.2 (`listHandoffConversationsForAgent`), ref-CRUD dropped, consumers updated 4b.5. ✔
- `conversationChunks` → unified `embeddings`: 4c.1–4c.3. ✔
- `agents/[id]/chat` + `public/.../chat`: persistence verified 4a.6, ref-call cleanup 4b.5. ✔
- `hooks/[hookId]/chat`: imports the same conversation helpers (signatures unchanged) → migrates transparently; **add a verification grep in 4a.6** (noted). ✔
- `public/.../feedback`: 4b.4. ✔
- `agents/conversations` (route + pages + sidebar): 4a.4/4a.5, route already thin. ✔
- `ai/conversation-rag`: 4c.2. ✔
- `sync-embeddings`: 4c.3. ✔
- `dataLogs`: NOT a conversation collection — the spec groups it loosely; `dataLogs` is data-connection logging owned by Phase 6 (`data/connections`). **Out of scope here**, noted as deferred. ✔
- pgvector dim 1536 round-trip + similarity query: 4c.1/4c.2 tests. ✔ (spec Risk item satisfied)
- DEFERRED Phase-5 inbox routes + `channel-*`: explicitly excluded (decision 6). ✔

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows full code. The conversation-rag rewrite (4c.2 Step 3) shows the load-bearing query and threading; the unchanged formatting helpers are explicitly named as kept. No undefined symbols: `rowToConversation`, `messageRowToMessage`, `loadConversation`, `insertMessages`, `isUuid`, `listHandoffConversationsForAgent`, `recordConversationFeedback`, `closeConversation`, `listUnsummarizedVisitorConversations`, `updateConversationSummary`, `getConversationAnyAgent`, `setAgentEmbeddingsSyncedAt`, `deleteConversationEmbeddings` are all defined where first used.

**3. Type consistency:** Helper signatures use the established `(args, db: Db = getMigrateDb())` shape; `auto-summarize`/`upsert`/`buildAskAi` use `(args, deps = {})` because they also inject the OpenAI seam — called out explicitly and matched in tests + route callers. `VibeAgentConversation` produced identically by `rowToConversation` and legacy `mapConversationDoc`. `messages` table enum `role` cast consistently. `conversation_feedback.rating` enum matches `VibeAgentConversation.feedback.rating`. Timestamps mapped via `.toISOString()` everywhere. No naming drift (`listHandoffConversationsForAgent` used consistently; `updateConversationRef` fully removed, not half-renamed).

**Gaps fixed inline:** added `getConversationAnyAgent` requirement (4b.5 Step 3) and the hooks/[hookId]/chat verification grep (4a.6) during review.
