# Firestore → Postgres Phase 5: Channels & Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the WhatsApp inbox, Instagram inbox, and Chatwoot connection data layers, their consuming routes/webhooks, and the inbox agent-resolution + handler hot path from Firestore to Postgres — keeping staging fully working (connect account, receive inbound message, auto-reply, human reply, handoff) at every slice boundary.

**Architecture:** Each channel's `accounts.ts` / `conversations.ts` / `messages.ts` and chatwoot `connections.ts` are rewritten to call Drizzle directly against the existing `packages/adapter-postgres/src/schema/channels.ts` tables. Every helper takes an **optional `db` last param defaulting to `getMigrateDb()`** so it is `withTestDb`-testable. Webhook ingestion runs before any tenant GUC context (like identity/invite-code ops), so channel helpers use `getMigrateDb()` (BYPASSRLS) with explicit `WHERE tenant_id = $1` filters; RLS policies for these tables already exist (`drizzle/0001_rls_policies.sql`). `rowToX` mappers normalize Postgres rows back to the legacy `*Document` shapes the routes/UI expect, so consumers stay unchanged except for the import target. The channel inbox tables are **fully separate** from the core `conversations`/`messages` tables migrated in Phase 4: the per-channel `*_inbox_*` tables store the raw WhatsApp/Instagram transcript, while the agent-side conversation (created by `ensureConversation` with `externalId = inbox:{channel}:{accountId}:{contactId}`) lives in the core `conversations` table and is linked via `whatsapp_inbox_conversations.agent_conversation_id`.

**Tech Stack:** Drizzle ORM (`postgres-js`), `@vibesboard/adapter-postgres` (`getMigrateDb`/`schema`/`test-utils`), `uuidv7`, `crypto-js` (token encryption, unchanged), `node --test --experimental-strip-types --conditions react-server --experimental-test-isolation=none`.

---

## Key model decisions (read before starting)

1. **Doc IDs vs uuid PKs.** Firestore used the **contact phone (digits-only)** as the WhatsApp conversation doc ID and the **IGSID** as the Instagram conversation doc ID; messages used auto-IDs; accounts used auto-IDs. Postgres PKs are `uuid`. We therefore CANNOT reuse the contact id as the row PK. Instead:
   - Accounts/conversations/messages get fresh `uuidv7()` PKs.
   - Conversation lookup-by-contact uses the **unique business key** `(accountId, contactPhone)` / `(accountId, contactIgsid)` (indexed in the schema: `whatsapp_conversations_account_contact_idx`, `instagram_conversations_account_contact_idx`), NOT the PK. Helper signatures keep taking `contactPhone`/`contactIgsid` so callers are unchanged.
   - The legacy `*Document.id` field is mapped from the row's uuid `id` (callers only use it as an opaque key); UI route params still pass `contactPhone`/`contactIgsid`, which the helpers resolve to the row.

2. **`getOrCreateConversation` upsert + TOCTOU.** Inbound webhooks for the same contact can race (two messages arrive together). Firestore's doc-id-as-phone made create idempotent. In Postgres we add a **unique constraint on `(account_id, contact_phone)`** (WhatsApp) and `(account_id, contact_igsid)` (Instagram) via a new migration, then `getOrCreateConversation` does `INSERT ... ON CONFLICT (account_id, contact_phone) DO UPDATE SET updated_at = excluded.updated_at RETURNING *` inside a transaction (the invite-code TOCTOU lesson: rely on a DB unique constraint, not read-then-write). `windowExpiresAt` is NOT NULL in the schema, so create must always set it (24h from now).

3. **Token field renames (chatwoot).** The Firestore `ChatwootConnectionDocument` uses `encryptedApiToken` / `encryptedBotToken`; the Postgres `chatwoot_connections` table uses `apiTokenEncrypted` / `botTokenEncrypted` (and `webhookSecretHash`, `agentBotId`, etc.). `rowToChatwootConnection` remaps column → legacy field names so `agent-handler.ts`, the webhook route, and the reply route (which read `connection.encryptedApiToken` etc.) keep working unchanged.

4. **`message.status` column is NOT NULL** in `whatsapp_inbox_messages` / `instagram_inbox_messages`. Inbound messages set `status: 'received'`, outbound `status: 'sent'`. `updateMessageStatus` (delivery receipts) looks up by `wa_message_id` / `ig_message_id` (both `.unique()`), scoped to `direction = 'outbound'`, with the same monotonic `statusOrder` guard, and writes only the `status` column (Firestore wrote ad-hoc `${status}At` fields which have no columns — **dropped**, out of scope).

5. **`findAccountByWabaId` / `findByoaAccountById` / `findAccountByPageId` / `getChatwootConnectionById`** were Firestore `collectionGroup` cross-tenant lookups (the webhook only knows the WABA/page/connection id, not the tenant). In Postgres these become a single `SELECT ... WHERE waba_id = $1 AND status = 'active' LIMIT 1` (no tenant filter — the row carries `tenant_id`), run on `getMigrateDb()`.

6. **`resolve-agent.ts` hot path.** Reads the inbox conversation row (flags `agentPaused`/`agentHandedOff`, `assignedAgentId`) then falls back to the account row (`assignedAgentId`, `agentAutoReply`). Both now read the Postgres channel tables via the new helpers (`getConversation`, `getInboxAccount`) on `getMigrateDb()`. No write, so no locking needed; it is a pure read. The handler's two `adminDb.collection(...).update(...)` calls (set `agentHandedOff`, set `agentConversationId`) become new helper writes `setConversationHandoff` / `linkAgentConversation`.

7. **Webhook path coherence (Phase 3 lesson).** A single slice must migrate the **entire** ingestion path for a channel so it never splits mid-path: `webhook route → processInboundMessages (find account) → storeInboundMessage (ensure conversation + append message) → triggerInboxAgent → resolveInboxAgent (read account/conversation) → handler (ensureConversation/updateConversationMessages in core conversations table, already Postgres from Phase 4) → reply-adapter (sendReply, append outbound message) → handler writes back handoff/link flags`. Because `resolve-agent.ts` and `handler.ts` are **shared** by both WhatsApp and Instagram, slice 5a migrates the WhatsApp data layer + its routes/webhook **but leaves resolve-agent/handler on Firestore**, and slice 5d flips resolve-agent/handler. To avoid a mid-path split during 5a/5b, resolve-agent/handler read forward into the migrated channel helpers from day one — see decision 8.

8. **Sequencing resolve-agent to avoid a split.** resolve-agent/handler call the channel helpers (`getConversation`, `getInboxAccount`) by import, not raw `adminDb`. If 5a swaps those helpers to Postgres, resolve-agent's *own* two remaining raw-`adminDb` reads (it inlines the conversation+account fetch rather than calling the helpers) would read Firestore while storeInboundMessage wrote Postgres — a split. **Fix:** in 5a/5b, rewrite resolve-agent to call the channel package helpers (`getConversation`, `getInboxAccount`) instead of inlining `adminDb`. Then resolve-agent is automatically Postgres for a channel the moment that channel's helpers flip. Slice 5d only needs to migrate the handler's two write-backs + the cross-channel concerns. This makes 5a and 5b each independently coherent end-to-end for their channel.

9. **Chatwoot is connection-only.** There are no chatwoot inbox conversation/message tables — the agent transcript lives in the core `conversations` table (Phase 4, `externalId = chatwoot:{accountId}:{convId}`). So 5c migrates only `connections.ts` (CRUD + stats + `getChatwootConnectionById`) and the reply route's connection lookup. The reply route's `getConversation`/`updateConversationMessages` are already Postgres (Phase 4).

10. **New deps + test scripts.** `channel-whatsapp`, `channel-instagram`, `channel-chatwoot` currently have NO `@vibesboard/adapter-postgres`/`drizzle-orm`/`uuidv7` deps and NO `test` script. Each slice's first task adds them (mirroring `packages/agents/package.json`).

---

## File map

| File | Slice | Change |
|---|---|---|
| `packages/adapter-postgres/src/schema/channels.ts` | 5a | Add unique constraints on `(accountId, contactPhone)` / `(accountId, contactIgsid)` |
| `packages/adapter-postgres/drizzle/0007_channel_contact_unique.sql` | 5a | New migration for the two unique constraints |
| `packages/channel-whatsapp/package.json` | 5a | Add pg/drizzle/uuidv7 deps + `test` script |
| `packages/channel-whatsapp/src/db.ts` | 5a | New: `rowToWhatsappAccount`, `rowToWhatsappConversation`, `rowToWhatsappMessage` mappers |
| `packages/channel-whatsapp/src/accounts.ts` | 5a | Rewrite storage ops to Postgres (keep Meta-API fns) |
| `packages/channel-whatsapp/src/conversations.ts` | 5a | Rewrite to Postgres |
| `packages/channel-whatsapp/src/messages.ts` | 5a | Rewrite storage to Postgres (keep Meta send) |
| `packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts` | 5a | Create |
| `apps/web/app/api/tenants/[id]/whatsapp-inbox/accounts/[accountId]/route.ts` | 5a | PATCH account-assignment via new helper |
| `apps/web/app/api/.../whatsapp-inbox/.../conversations/[contactPhone]/route.ts` | 5a | per-conversation assignment via helper |
| `packages/inbox/src/resolve-agent.ts` | 5a/5b | Call channel helpers instead of inline `adminDb` |
| `packages/channel-instagram/*` (parallel set) | 5b | Same as WhatsApp |
| `packages/channel-chatwoot/package.json` | 5c | Add pg/drizzle/uuidv7 deps + `test` script |
| `packages/channel-chatwoot/src/db.ts` | 5c | New: `rowToChatwootConnection` mapper |
| `packages/channel-chatwoot/src/connections.ts` | 5c | Rewrite to Postgres |
| `packages/channel-chatwoot/src/__tests__/connections.test.ts` | 5c | Create |
| `apps/web/app/api/agents/[id]/chatwoot/connections/route.ts` (+`[connectionId]`, `validate`, `integrations/status`) | 5c | Replace raw `adminDb` reads with helpers |
| `apps/web/app/api/agents/[id]/conversations/[cid]/reply/route.ts` | 5c | unchanged code; verify (connection lookup now Postgres) |
| `packages/inbox/src/handler.ts` | 5d | Write-back flags via new channel helpers |
| `packages/channel-whatsapp/src/conversations.ts` + instagram | 5d | Add `setConversationHandoff`, `linkAgentConversation` |
| `packages/inbox/package.json` | 5d | Add pg dep (for any direct schema import in tests) |
| `packages/inbox/src/inbox-agent.test.ts` | 5d | Update to Postgres harness |

---

## Slice 5a — WhatsApp data layer + routes/webhook (+ resolve-agent reads WhatsApp from Postgres)

**Outcome:** Connecting a WhatsApp account, receiving an inbound message, listing conversations/messages, sending a human reply, and the agent auto-reply for WhatsApp all run end-to-end on Postgres. Instagram + chatwoot remain on Firestore.

### Task 5a.1: schema unique constraint + migration + package deps

**Files:**
- Modify: `packages/adapter-postgres/src/schema/channels.ts`
- Create: `packages/adapter-postgres/drizzle/0007_channel_contact_unique.sql`
- Modify: `packages/channel-whatsapp/package.json`

- [ ] **Step 1: Add unique constraints to the schema** (replace the index-only `(t) => ({...})` blocks)

In `channels.ts`, import `unique` from `drizzle-orm/pg-core`, and in `whatsappConversations` add:

```ts
(t) => ({
  byAccountContact: index('whatsapp_conversations_account_contact_idx').on(t.accountId, t.contactPhone),
  byAgent: index('whatsapp_conversations_agent_idx').on(t.assignedAgentId),
  uniqAccountContact: unique('whatsapp_conversations_account_contact_uniq').on(t.accountId, t.contactPhone),
})
```

and in `instagramConversations`:

```ts
(t) => ({
  byAccountContact: index('instagram_conversations_account_contact_idx').on(t.accountId, t.contactIgsid),
  uniqAccountContact: unique('instagram_conversations_account_contact_uniq').on(t.accountId, t.contactIgsid),
})
```

- [ ] **Step 2: Write the migration** `packages/adapter-postgres/drizzle/0007_channel_contact_unique.sql`

```sql
ALTER TABLE "whatsapp_inbox_conversations"
  ADD CONSTRAINT "whatsapp_conversations_account_contact_uniq" UNIQUE ("account_id", "contact_phone");--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations"
  ADD CONSTRAINT "instagram_conversations_account_contact_uniq" UNIQUE ("account_id", "contact_igsid");
```

- [ ] **Step 3: Add deps + test script to `packages/channel-whatsapp/package.json`**

Add to `dependencies`: `"@vibesboard/adapter-postgres": "workspace:*"`, `"drizzle-orm": "^0.45.2"`, `"uuidv7": "^1.0.2"`. Add to `scripts`:

```json
"test": "node --experimental-strip-types --conditions react-server --test --experimental-test-isolation=none 'src/**/*.test.ts'"
```

- [ ] **Step 4: Install + verify migration applies in a test schema**

Run: `pnpm install` then `cd packages/adapter-postgres && npm test` (the `withTestDb` harness replays all `drizzle/*.sql` including 0007).
Expected: existing adapter tests still PASS (migration parses).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-postgres/src/schema/channels.ts packages/adapter-postgres/drizzle/0007_channel_contact_unique.sql packages/channel-whatsapp/package.json
git commit -m "feat(channels): unique (account,contact) constraint + whatsapp pg deps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5a.2: WhatsApp `rowToX` mappers

**Files:**
- Create: `packages/channel-whatsapp/src/db.ts`
- Create: `packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToWhatsappAccount, rowToWhatsappConversation, rowToWhatsappMessage } from '../db.ts'

describe('whatsapp mappers', () => {
  test('rowToWhatsappAccount maps row to legacy doc shape', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const acc = rowToWhatsappAccount({
      id: 'a1', tenantId: 't1', wabaId: 'w1', phoneNumberId: 'p1',
      displayPhoneNumber: '+1', businessName: 'Biz', accessTokenEncrypted: 'enc',
      scopes: ['s'], status: 'active', connectedBy: 'u1', connectedAt: now,
      webhookSubscribed: true, connectionMethod: 'oauth', metaAppId: null,
      metaAppSecretEncrypted: null, webhookVerifyTokenEncrypted: null, byoaWebhookUrl: null,
      assignedAgentId: null, agentAutoReply: false, createdAt: now, updatedAt: now,
    } as any)
    assert.equal(acc.id, 'a1')
    assert.equal(acc.accessToken, 'enc')
    assert.equal(acc.connectedAt, '2026-05-25T00:00:00.000Z')
    assert.equal(acc.agentAutoReply, false)
  })

  test('rowToWhatsappConversation maps id + window', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToWhatsappConversation({
      id: 'c1', tenantId: 't1', accountId: 'a1', contactPhone: '15551234',
      contactName: null, contactProfileName: null, lastMessageAt: now,
      lastMessagePreview: 'hi', unreadCount: 2, assignedTo: null, assignedAgentId: null,
      agentPaused: false, agentHandedOff: false, agentConversationId: null,
      status: 'open', windowExpiresAt: now, createdAt: now, updatedAt: now,
    } as any)
    assert.equal(c.id, 'c1')
    assert.equal(c.contactPhone, '15551234')
    assert.equal(c.unreadCount, 2)
    assert.equal(c.windowExpiresAt, '2026-05-25T00:00:00.000Z')
  })

  test('rowToWhatsappMessage maps type/direction/status', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const m = rowToWhatsappMessage({
      id: 'm1', tenantId: 't1', conversationId: 'c1', waMessageId: 'wamid.1',
      fromAddr: '15551234', toAddr: 'p1', type: 'text', text: 'hi', mediaUrl: null,
      caption: null, direction: 'inbound', status: 'received', sentBy: null,
      sentByAgentName: null, timestampOriginal: now, createdAt: now,
    } as any)
    assert.equal(m.waMessageId, 'wamid.1')
    assert.equal(m.from, '15551234')
    assert.equal(m.to, 'p1')
    assert.equal(m.timestamp, '2026-05-25T00:00:00.000Z')
    assert.equal(m.direction, 'inbound')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/channel-whatsapp && npm test`
Expected: FAIL — `../db.ts` does not exist.

- [ ] **Step 3: Implement `packages/channel-whatsapp/src/db.ts`**

```ts
import type {
  WhatsappAccount, WhatsappConversation, WhatsappMessage,
} from '@vibesboard/adapter-postgres/schema'
import type {
  WhatsAppInboxAccountDocument,
  WhatsAppInboxConversationDocument,
  WhatsAppInboxMessageDocument,
} from '@vibesboard/contracts'

export const rowToWhatsappAccount = (r: WhatsappAccount): WhatsAppInboxAccountDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  wabaId: r.wabaId,
  phoneNumberId: r.phoneNumberId,
  displayPhoneNumber: r.displayPhoneNumber,
  businessName: r.businessName,
  accessToken: r.accessTokenEncrypted,
  scopes: r.scopes ?? [],
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  webhookSubscribed: r.webhookSubscribed,
  connectionMethod: r.connectionMethod ?? undefined,
  metaAppId: r.metaAppId ?? undefined,
  metaAppSecret: r.metaAppSecretEncrypted ?? undefined,
  webhookVerifyToken: r.webhookVerifyTokenEncrypted ?? undefined,
  byoaWebhookUrl: r.byoaWebhookUrl ?? undefined,
  assignedAgentId: r.assignedAgentId ?? null,
  agentAutoReply: r.agentAutoReply,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const rowToWhatsappConversation = (r: WhatsappConversation): WhatsAppInboxConversationDocument => ({
  id: r.id,
  accountId: r.accountId,
  contactName: r.contactName ?? undefined,
  contactPhone: r.contactPhone,
  contactProfileName: r.contactProfileName ?? undefined,
  lastMessageAt: r.lastMessageAt.toISOString(),
  lastMessagePreview: r.lastMessagePreview,
  unreadCount: r.unreadCount,
  assignedTo: r.assignedTo ?? undefined,
  assignedAgentId: r.assignedAgentId ?? null,
  agentPaused: r.agentPaused,
  agentHandedOff: r.agentHandedOff,
  agentConversationId: r.agentConversationId ?? null,
  status: r.status,
  windowExpiresAt: r.windowExpiresAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const rowToWhatsappMessage = (r: WhatsappMessage): WhatsAppInboxMessageDocument => ({
  id: r.id,
  waMessageId: r.waMessageId,
  from: r.fromAddr,
  to: r.toAddr,
  type: r.type,
  text: r.text ?? undefined,
  mediaUrl: r.mediaUrl ?? undefined,
  caption: r.caption ?? undefined,
  direction: r.direction,
  status: r.status,
  timestamp: r.timestampOriginal.toISOString(),
  sentBy: r.sentBy ?? undefined,
  sentByAgentName: r.sentByAgentName ?? undefined,
  createdAt: r.createdAt.toISOString(),
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/channel-whatsapp && npm test`
Expected: PASS (3 mapper tests).

- [ ] **Step 5: Commit**

```bash
git add packages/channel-whatsapp/src/db.ts packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts
git commit -m "feat(channel-whatsapp): rowToX Postgres mappers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5a.3: WhatsApp account storage ops on Postgres

**Files:**
- Modify: `packages/channel-whatsapp/src/accounts.ts`
- Test: `packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  listInboxAccounts, getInboxAccount, disconnectInboxAccount,
  findAccountByWabaId, updateAccountAssignment, createAccountRow,
} from '../accounts.ts'

async function seedTenant(adminDb: any) {
  const u = randomUUID(); const t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  return { tenantId: t, userId: u }
}

describe('whatsapp accounts (pg)', () => {
  test('create / list / get / disconnect / findByWaba / assignment', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createAccountRow({
        tenantId, wabaId: 'waba-1', phoneNumberId: 'pn-1', displayPhoneNumber: '+1',
        businessName: 'Biz', accessTokenEncrypted: 'enc', connectedBy: userId,
        connectionMethod: 'api_key', webhookSubscribed: true,
        scopes: ['whatsapp_business_messaging'],
      }, adminDb)
      assert.ok(created.id)

      const list = await listInboxAccounts(tenantId, adminDb)
      assert.equal(list.length, 1)

      const got = await getInboxAccount(tenantId, created.id, adminDb)
      assert.equal(got?.wabaId, 'waba-1')

      const found = await findAccountByWabaId('waba-1', adminDb)
      assert.equal(found?.tenantId, tenantId)

      await updateAccountAssignment(tenantId, created.id, { assignedAgentId: null, agentAutoReply: true }, adminDb)
      const after = await getInboxAccount(tenantId, created.id, adminDb)
      assert.equal(after?.agentAutoReply, true)

      await disconnectInboxAccount(tenantId, created.id, adminDb)
      const disc = await getInboxAccount(tenantId, created.id, adminDb)
      assert.equal(disc?.status, 'disconnected')
      assert.equal(await findAccountByWabaId('waba-1', adminDb), null) // only active
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/channel-whatsapp && npm test`
Expected: FAIL — new functions not exported / wrong signatures.

- [ ] **Step 3: Rewrite `accounts.ts` storage ops**

Keep `encryptToken`/`decryptToken` and ALL Meta Graph API functions (`exchangeCodeForToken`, `getWABAFromToken`, `subscribeToWebhooks`, `getPhoneNumbers`) unchanged. Replace the `adminDb` header + storage ops. New top-of-file:

```ts
import { and, eq, desc } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { whatsappAccounts } from '@vibesboard/adapter-postgres/schema'
import { rowToWhatsappAccount } from './db.ts'
import type { WhatsAppInboxAccountDocument } from '@vibesboard/contracts'
// ...existing CryptoJS + type imports (drop the adminDb + Collections imports)

type Db = PostgresJsDatabase<typeof schema>

export interface CreateAccountRowParams {
  tenantId: string; wabaId: string; phoneNumberId: string; displayPhoneNumber: string
  businessName: string; accessTokenEncrypted: string; connectedBy: string
  connectionMethod: 'oauth' | 'api_key' | 'byoa'; webhookSubscribed: boolean
  scopes: string[]
  metaAppId?: string; metaAppSecretEncrypted?: string
  webhookVerifyTokenEncrypted?: string; byoaWebhookUrl?: string
}

async function existsActiveWaba(db: Db, tenantId: string, wabaId: string): Promise<boolean> {
  const [row] = await db.select({ id: whatsappAccounts.id }).from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.tenantId, tenantId), eq(whatsappAccounts.wabaId, wabaId), eq(whatsappAccounts.status, 'active')))
    .limit(1)
  return !!row
}

export async function createAccountRow(
  p: CreateAccountRowParams, db: Db = getMigrateDb(),
): Promise<WhatsAppInboxAccountDocument> {
  const id = uuidv7()
  const [row] = await db.insert(whatsappAccounts).values({
    id, tenantId: p.tenantId, wabaId: p.wabaId, phoneNumberId: p.phoneNumberId,
    displayPhoneNumber: p.displayPhoneNumber, businessName: p.businessName,
    accessTokenEncrypted: p.accessTokenEncrypted, scopes: p.scopes, status: 'active',
    connectedBy: p.connectedBy, webhookSubscribed: p.webhookSubscribed,
    connectionMethod: p.connectionMethod, metaAppId: p.metaAppId ?? null,
    metaAppSecretEncrypted: p.metaAppSecretEncrypted ?? null,
    webhookVerifyTokenEncrypted: p.webhookVerifyTokenEncrypted ?? null,
    byoaWebhookUrl: p.byoaWebhookUrl ?? null,
  }).returning()
  return rowToWhatsappAccount(row)
}

export async function listInboxAccounts(tenantId: string, db: Db = getMigrateDb()): Promise<WhatsAppInboxAccountDocument[]> {
  const rows = await db.select().from(whatsappAccounts)
    .where(eq(whatsappAccounts.tenantId, tenantId)).orderBy(desc(whatsappAccounts.createdAt))
  return rows.map(rowToWhatsappAccount)
}

export async function getInboxAccount(tenantId: string, accountId: string, db: Db = getMigrateDb()): Promise<WhatsAppInboxAccountDocument | null> {
  const [row] = await db.select().from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.tenantId, tenantId), eq(whatsappAccounts.id, accountId))).limit(1)
  return row ? rowToWhatsappAccount(row) : null
}

export async function disconnectInboxAccount(tenantId: string, accountId: string, db: Db = getMigrateDb()): Promise<void> {
  await db.update(whatsappAccounts).set({ status: 'disconnected', updatedAt: new Date() })
    .where(and(eq(whatsappAccounts.tenantId, tenantId), eq(whatsappAccounts.id, accountId)))
}

export async function updateAccountAssignment(
  tenantId: string, accountId: string,
  patch: { assignedAgentId?: string | null; agentAutoReply?: boolean }, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappAccounts).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(whatsappAccounts.tenantId, tenantId), eq(whatsappAccounts.id, accountId)))
}

export async function findAccountByWabaId(wabaId: string, db: Db = getMigrateDb()): Promise<{ account: WhatsAppInboxAccountDocument; tenantId: string } | null> {
  const [row] = await db.select().from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.wabaId, wabaId), eq(whatsappAccounts.status, 'active'))).limit(1)
  return row ? { account: rowToWhatsappAccount(row), tenantId: row.tenantId } : null
}

export async function findByoaAccountById(accountId: string, db: Db = getMigrateDb()): Promise<{ account: WhatsAppInboxAccountDocument; tenantId: string } | null> {
  const [row] = await db.select().from(whatsappAccounts)
    .where(and(eq(whatsappAccounts.id, accountId), eq(whatsappAccounts.connectionMethod, 'byoa'), eq(whatsappAccounts.status, 'active'))).limit(1)
  return row ? { account: rowToWhatsappAccount(row), tenantId: row.tenantId } : null
}

export async function getAccountWithToken(tenantId: string, accountId: string, db: Db = getMigrateDb()): Promise<{ account: WhatsAppInboxAccountDocument; accessToken: string }> {
  const account = await getInboxAccount(tenantId, accountId, db)
  if (!account) throw new Error('Inbox account not found')
  if (account.status !== 'active') throw new Error('Inbox account is not active')
  return { account, accessToken: decryptToken(account.accessToken) }
}
```

Then rewrite `connectOAuthAccount`/`connectApiKeyAccount`/`connectByoaAccount` to: call the unchanged Meta fns, run `existsActiveWaba(db, tenantId, wabaId)` (replacing the Firestore duplicate check, throwing the same message), and finish with `createAccountRow({...})` instead of `docRef.set`. For BYOA, compute `byoaWebhookUrl` from a pre-generated `const id = uuidv7()` and pass that same `id`... — simpler: keep `createAccountRow` generating the id, but BYOA needs the id inside the URL. **Resolve:** add an optional `id?: string` to `CreateAccountRowParams` (use `p.id ?? uuidv7()`); BYOA pre-generates `const id = uuidv7()`, builds the URL with it, and passes `id` + `byoaWebhookUrl` into `createAccountRow`.

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/channel-whatsapp && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/channel-whatsapp/src/accounts.ts packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts
git commit -m "feat(channel-whatsapp): account storage on Postgres

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5a.4: WhatsApp conversation ops on Postgres (with ON CONFLICT upsert)

**Files:**
- Modify: `packages/channel-whatsapp/src/conversations.ts`
- Test: `packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import {
  getOrCreateConversation, listConversations, getConversation as getWaConversation,
  updateConversationStatus, assignConversation, markAsRead,
} from '../conversations.ts'
import { whatsappAccounts } from '@vibesboard/adapter-postgres/schema'

async function seedAccount(adminDb: any) {
  const { tenantId, userId } = await seedTenant(adminDb)
  const id = randomUUID()
  await adminDb.insert(whatsappAccounts).values({
    id, tenantId, wabaId: 'w', phoneNumberId: 'p', displayPhoneNumber: '+1',
    businessName: 'B', accessTokenEncrypted: 'e', scopes: [], connectedBy: userId,
    webhookSubscribed: true, windowExpiresAt: new Date(),
  })
  return { tenantId, accountId: id, userId }
}

describe('whatsapp conversations (pg)', () => {
  test('getOrCreate is idempotent on (account, contactPhone)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const a = await getOrCreateConversation(tenantId, accountId, '+1 (555) 123-4', 'Alice', adminDb)
      const b = await getOrCreateConversation(tenantId, accountId, '15551234', undefined, adminDb)
      assert.equal(a.id, b.id) // same row — phone normalized to digits
      assert.equal(a.contactPhone, '15551234')
    })
  })

  test('list / get / status / assign / markAsRead', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      await getOrCreateConversation(tenantId, accountId, '15551234', 'Alice', adminDb)
      const list = await listConversations(tenantId, accountId, undefined, adminDb)
      assert.equal(list.length, 1)
      const c = await getWaConversation(tenantId, accountId, '15551234', adminDb)
      assert.equal(c?.contactName, 'Alice')
      await updateConversationStatus(tenantId, accountId, '15551234', 'resolved', adminDb)
      await assignConversation(tenantId, accountId, '15551234', null, adminDb)
      await markAsRead(tenantId, accountId, '15551234', adminDb)
      const c2 = await getWaConversation(tenantId, accountId, '15551234', adminDb)
      assert.equal(c2?.status, 'resolved')
      assert.equal(c2?.unreadCount, 0)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/channel-whatsapp && npm test`

- [ ] **Step 3: Rewrite `conversations.ts`**

```ts
import { and, eq, desc } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { whatsappConversations } from '@vibesboard/adapter-postgres/schema'
import { rowToWhatsappConversation } from './db.ts'
import type { WhatsAppInboxConversationDocument, InboxConversationStatus } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>
const WINDOW_MS = 24 * 60 * 60 * 1000

async function findRow(db: Db, tenantId: string, accountId: string, phone: string) {
  const [row] = await db.select().from(whatsappConversations)
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.accountId, accountId), eq(whatsappConversations.contactPhone, phone)))
    .limit(1)
  return row ?? null
}

export async function getOrCreateConversation(
  tenantId: string, accountId: string, contactPhone: string, contactName?: string, db: Db = getMigrateDb(),
): Promise<WhatsAppInboxConversationDocument> {
  const phone = contactPhone.replace(/\D/g, '')
  const [row] = await db.insert(whatsappConversations).values({
    id: uuidv7(), tenantId, accountId, contactPhone: phone,
    contactName: contactName ?? null, contactProfileName: contactName ?? null,
    windowExpiresAt: new Date(Date.now() + WINDOW_MS),
  }).onConflictDoUpdate({
    target: [whatsappConversations.accountId, whatsappConversations.contactPhone],
    set: { updatedAt: new Date() },
  }).returning()
  return rowToWhatsappConversation(row)
}

export async function listConversations(
  tenantId: string, accountId: string, status?: InboxConversationStatus, db: Db = getMigrateDb(),
): Promise<WhatsAppInboxConversationDocument[]> {
  const conds = [eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.accountId, accountId)]
  if (status) conds.push(eq(whatsappConversations.status, status))
  const rows = await db.select().from(whatsappConversations).where(and(...conds))
    .orderBy(desc(whatsappConversations.lastMessageAt)).limit(100)
  return rows.map(rowToWhatsappConversation)
}

export async function getConversation(
  tenantId: string, accountId: string, contactPhone: string, db: Db = getMigrateDb(),
): Promise<WhatsAppInboxConversationDocument | null> {
  const row = await findRow(db, tenantId, accountId, contactPhone.replace(/\D/g, ''))
  return row ? rowToWhatsappConversation(row) : null
}

export async function updateConversationStatus(
  tenantId: string, accountId: string, contactPhone: string, status: InboxConversationStatus, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappConversations).set({ status, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.accountId, accountId), eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))))
}

export async function assignConversation(
  tenantId: string, accountId: string, contactPhone: string, userId: string | null, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappConversations).set({ assignedTo: userId, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.accountId, accountId), eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))))
}

export async function markAsRead(
  tenantId: string, accountId: string, contactPhone: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappConversations).set({ unreadCount: 0, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.accountId, accountId), eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))))
}

export function isWithinMessageWindow(conversation: WhatsAppInboxConversationDocument): boolean {
  if (!conversation.windowExpiresAt) return false
  return new Date(conversation.windowExpiresAt) > new Date()
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/channel-whatsapp && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/channel-whatsapp/src/conversations.ts packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts
git commit -m "feat(channel-whatsapp): conversation ops on Postgres (ON CONFLICT upsert)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5a.5: WhatsApp message ops on Postgres (store inbound / send reply / list / status)

**Files:**
- Modify: `packages/channel-whatsapp/src/messages.ts`
- Test: `packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { listMessages, updateMessageStatus } from '../messages.ts'
import { whatsappMessages, whatsappConversations as waConvTbl } from '@vibesboard/adapter-postgres/schema'

describe('whatsapp messages (pg)', () => {
  test('insert inbound updates conversation; list returns chronological; status monotonic', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(tenantId, accountId, '15551234', 'Alice', adminDb)
      // Simulate storeInboundMessage's persistence by calling the exported persistInbound:
      const { persistInboundMessage } = await import('../messages.ts')
      await persistInboundMessage({
        tenantId, accountId, conversationId: convo.id, contactPhone: '15551234',
        phoneNumberId: 'p', waMessageId: 'wamid.in.1', type: 'text', text: 'hi',
        timestampOriginal: new Date('2026-05-25T01:00:00Z'), contactName: 'Alice',
      }, adminDb)
      const msgs = await listMessages(tenantId, accountId, '15551234', 50, undefined, adminDb)
      assert.equal(msgs.length, 1)
      assert.equal(msgs[0].text, 'hi')
      const [c] = await adminDb.select().from(waConvTbl).where(eq(waConvTbl.id, convo.id))
      assert.equal(c.unreadCount, 1)
      assert.equal(c.lastMessagePreview, 'hi')

      // status monotonic guard
      const { persistOutboundMessage } = await import('../messages.ts')
      await persistOutboundMessage({
        tenantId, accountId, conversationId: convo.id, contactPhone: '15551234',
        waMessageId: 'wamid.out.1', from: '+1', text: 'hello', timestampOriginal: new Date(),
      }, adminDb)
      await updateMessageStatus('wamid.out.1', 'delivered', undefined, adminDb)
      await updateMessageStatus('wamid.out.1', 'sent', undefined, adminDb) // ignored (backwards)
      const [m] = await adminDb.select().from(whatsappMessages).where(eq(whatsappMessages.waMessageId, 'wamid.out.1'))
      assert.equal(m.status, 'delivered')
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/channel-whatsapp && npm test`

- [ ] **Step 3: Rewrite `messages.ts`**

Keep the `META_GRAPH_API` constant and the Meta send `fetch`. Replace the `adminDb`/`FieldValue`/`batch` storage with Drizzle, extracting two reusable persisters so the test can drive them directly. New header + persisters:

```ts
import { and, eq, asc, lt } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { whatsappMessages, whatsappConversations } from '@vibesboard/adapter-postgres/schema'
import { getOrCreateConversation } from './conversations.ts'
import { getAccountWithToken } from './accounts.ts'
import { rowToWhatsappMessage } from './db.ts'
import type { WhatsAppInboxMessageDocument, InboxMessageStatus } from '@vibesboard/contracts'
import type { StoreInboundParams, SendReplyParams } from './types.ts'

type Db = PostgresJsDatabase<typeof schema>
const WINDOW_MS = 24 * 60 * 60 * 1000
const statusOrder: Record<string, number> = { received: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

interface PersistInboundArgs {
  tenantId: string; accountId: string; conversationId: string; contactPhone: string
  phoneNumberId: string; waMessageId: string; type: WhatsAppInboxMessageDocument['type']
  text?: string; mediaUrl?: string; caption?: string; timestampOriginal: Date; contactName?: string
}

export async function persistInboundMessage(a: PersistInboundArgs, db: Db = getMigrateDb()): Promise<WhatsAppInboxMessageDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(whatsappMessages).values({
      id: uuidv7(), tenantId: a.tenantId, conversationId: a.conversationId,
      waMessageId: a.waMessageId, fromAddr: a.contactPhone, toAddr: a.phoneNumberId,
      type: a.type, text: a.text ?? null, mediaUrl: a.mediaUrl ?? null, caption: a.caption ?? null,
      direction: 'inbound', status: 'received', timestampOriginal: a.timestampOriginal,
    }).returning()
    await tx.update(whatsappConversations).set({
      lastMessageAt: a.timestampOriginal, lastMessagePreview: (a.text ?? '').slice(0, 100),
      unreadCount: schema.sql`${whatsappConversations.unreadCount} + 1`,
      ...(a.contactName ? { contactProfileName: a.contactName } : {}),
      windowExpiresAt: new Date(Date.now() + WINDOW_MS), status: 'open', updatedAt: new Date(),
    }).where(eq(whatsappConversations.id, a.conversationId))
    return rowToWhatsappMessage(row)
  })
}
```

(Note: import `sql` explicitly — `import { and, eq, asc, lt, sql } from 'drizzle-orm'` — and use `sql\`${whatsappConversations.unreadCount} + 1\``; the `schema.sql` above is shorthand, replace with the imported `sql`.)

```ts
interface PersistOutboundArgs {
  tenantId: string; accountId: string; conversationId: string; contactPhone: string
  waMessageId: string; from: string; text: string; timestampOriginal: Date
  sentBy?: string; sentByAgentName?: string
}

export async function persistOutboundMessage(a: PersistOutboundArgs, db: Db = getMigrateDb()): Promise<WhatsAppInboxMessageDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(whatsappMessages).values({
      id: uuidv7(), tenantId: a.tenantId, conversationId: a.conversationId,
      waMessageId: a.waMessageId, fromAddr: a.from, toAddr: a.contactPhone,
      type: 'text', text: a.text, direction: 'outbound', status: 'sent',
      timestampOriginal: a.timestampOriginal, sentBy: a.sentBy ?? null,
      sentByAgentName: a.sentByAgentName ?? null,
    }).returning()
    await tx.update(whatsappConversations).set({
      lastMessageAt: a.timestampOriginal, lastMessagePreview: a.text.slice(0, 100), updatedAt: new Date(),
    }).where(eq(whatsappConversations.id, a.conversationId))
    return rowToWhatsappMessage(row)
  })
}
```

Rewrite `storeInboundMessage(params: StoreInboundParams)` to: derive `text`/`mediaUrl`/`caption` exactly as today (the `switch (message.type)` block is unchanged), call `const convo = await getOrCreateConversation(tenantId, accountId, message.from, contactName, db)`, then `return persistInboundMessage({ tenantId, accountId, conversationId: convo.id, contactPhone: convo.contactPhone, phoneNumberId: params.phoneNumberId, waMessageId: message.id, type: message.type as any, text, mediaUrl, caption, timestampOriginal: message.timestamp ? new Date(parseInt(message.timestamp) * 1000) : new Date(), contactName }, db)`.

Rewrite `sendReply(params: SendReplyParams)` to: `const phone = contactPhone.replace(/\D/g,'')`, load the convo via `getConversation` (throw 'Conversation not found' if null), enforce the 24h window using `isWithinMessageWindow` (same error message), `getAccountWithToken`, do the unchanged Meta `fetch`, then `return persistOutboundMessage({ ..., conversationId: <convo row id>, from: account.displayPhoneNumber, sentBy: userId, sentByAgentName }, db)`. (Fetch the convo row id by calling `getOrCreateConversation` — idempotent — or by `getConversation` then resolving the id; use `getConversation` which returns `.id`.)

Rewrite `listMessages`:

```ts
export async function listMessages(
  tenantId: string, accountId: string, contactPhone: string, limit = 50, before?: string, db: Db = getMigrateDb(),
): Promise<WhatsAppInboxMessageDocument[]> {
  const convo = await getConversation(tenantId, accountId, contactPhone, db)
  if (!convo) return []
  const conds = [eq(whatsappMessages.conversationId, convo.id)]
  if (before) conds.push(lt(whatsappMessages.timestampOriginal, new Date(before)))
  const rows = await db.select().from(whatsappMessages).where(and(...conds))
    .orderBy(asc(whatsappMessages.timestampOriginal)).limit(limit)
  return rows.map(rowToWhatsappMessage)
}
```

Rewrite `updateMessageStatus`:

```ts
export async function updateMessageStatus(
  waMessageId: string, status: InboxMessageStatus, _timestamp?: string, db: Db = getMigrateDb(),
): Promise<void> {
  const [row] = await db.select({ id: whatsappMessages.id, status: whatsappMessages.status }).from(whatsappMessages)
    .where(and(eq(whatsappMessages.waMessageId, waMessageId), eq(whatsappMessages.direction, 'outbound'))).limit(1)
  if (!row) return
  if (statusOrder[status] !== undefined && statusOrder[row.status] !== undefined && statusOrder[status] <= statusOrder[row.status]) return
  await db.update(whatsappMessages).set({ status }).where(eq(whatsappMessages.id, row.id))
}
```

(`import { getConversation } from './conversations.ts'` for the helpers above.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/channel-whatsapp && npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/channel-whatsapp/src/messages.ts packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts
git commit -m "feat(channel-whatsapp): message store/send/list/status on Postgres

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5a.6: Wire the WhatsApp connect-flows + routes; resolve-agent reads WhatsApp via helpers

**Files:**
- Modify: `packages/channel-whatsapp/src/accounts.ts` (finish connect-flow bodies — see 5a.3 Step 3)
- Modify: `apps/web/app/api/tenants/[id]/whatsapp-inbox/accounts/[accountId]/route.ts`
- Modify: `apps/web/app/api/tenants/[id]/whatsapp-inbox/accounts/[accountId]/conversations/[contactPhone]/route.ts`
- Modify: `packages/inbox/src/resolve-agent.ts`

- [ ] **Step 1: account PATCH route → `updateAccountAssignment`**

In `.../accounts/[accountId]/route.ts`, the PATCH handler builds an `updates` object then does `adminDb.collection(accountPath).doc(accountId).update(updates)`. Replace with:

```ts
import { getInboxAccount, disconnectInboxAccount, updateAccountAssignment } from '@vibesboard/channel-whatsapp/accounts'
// ...build { assignedAgentId?, agentAutoReply? } from body (same validation incl. getAgentForMember check)...
await updateAccountAssignment(tenantId, accountId, updates)
```

Remove the `adminDb` + Firestore `accountPath` imports from this file. `getInboxAccount`/`disconnectInboxAccount` calls are unchanged (signatures backward-compatible — db defaults).

- [ ] **Step 2: per-conversation route → helpers**

In `.../conversations/[contactPhone]/route.ts`, the PATCH path uses `updateConversationStatus`/`assignConversation`/`markAsRead` (now Postgres, no change) plus a raw `adminDb.collection(...).update({ assignedAgentId, agentPaused })` for per-conversation agent override. Add a helper to `conversations.ts`:

```ts
export async function updateConversationAgentSettings(
  tenantId: string, accountId: string, contactPhone: string,
  patch: { assignedAgentId?: string | null; agentPaused?: boolean }, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappConversations).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.accountId, accountId), eq(whatsappConversations.contactPhone, contactPhone.replace(/\D/g, ''))))
}
```

Replace the raw `adminDb` block with `updateConversationAgentSettings(tenantId, accountId, contactPhone, agentUpdates)`. Remove `adminDb`/`Collections` from the route. (Add this helper + a one-line test in 5a.4's test file before relying on it — add a 6th assertion to the conversations test calling `updateConversationAgentSettings` and re-reading.)

- [ ] **Step 3: resolve-agent reads WhatsApp via channel helpers**

Rewrite `packages/inbox/src/resolve-agent.ts` so the WhatsApp branch uses the channel helpers instead of inline `adminDb`:

```ts
import 'server-only'
import { getAgentForMember } from '@vibesboard/agents/server'
import type { VibeAgent } from '@vibesboard/contracts'
import * as wa from '@vibesboard/channel-whatsapp/conversations'
import * as waAcc from '@vibesboard/channel-whatsapp/accounts'
// instagram imports added in 5b
export type InboxChannel = 'whatsapp' | 'instagram'

export async function resolveInboxAgent(
  tenantId: string, accountId: string, contactId: string, channel: InboxChannel,
): Promise<{ agentId: string; agent: VibeAgent } | null> {
  if (channel === 'whatsapp') {
    const convo = await wa.getConversation(tenantId, accountId, contactId)
    if (convo?.agentPaused || convo?.agentHandedOff) return null
    let agentId = convo?.assignedAgentId ?? undefined
    if (!agentId) {
      const account = await waAcc.getInboxAccount(tenantId, accountId)
      if (!account) return null
      if (account.agentAutoReply === false) return null
      agentId = account.assignedAgentId ?? undefined
    }
    if (!agentId) return null
    const agent = await getAgentForMember(tenantId, agentId)
    return agent ? { agentId, agent } : null
  }
  // instagram branch still Firestore until 5b — keep the existing adminDb code here
  // (leave the original instagram path intact; do NOT delete it)
  throw new Error('instagram resolve not migrated yet') // placeholder removed in 5b
}
```

IMPORTANT: do NOT throw for instagram — keep the original `adminDb`-based instagram code in an `else` branch verbatim from the current file (re-add the `adminDb`/`Collections`/instagram-doc-type imports it needs). Only the WhatsApp branch flips here. This keeps 5a's WhatsApp path fully Postgres (no split) while Instagram stays Firestore until 5b.

- [ ] **Step 4: Add pg dep to inbox package + build web**

Add `"@vibesboard/adapter-postgres": "workspace:*"` to `packages/inbox/package.json` dependencies (resolve-agent doesn't import it directly yet, but 5d will; harmless now — SKIP if you prefer, add in 5d). Run:

Run: `pnpm install && cd packages/channel-whatsapp && npm test && cd ../../apps/web && npm run build`
Expected: PASS / typechecks; `grep -rn "adminDb" apps/web/app/api/tenants/\[id\]/whatsapp-inbox` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web,inbox): whatsapp inbox routes + resolve-agent on Postgres

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Slice 5a staging e2e (API-level — real Meta webhooks not drivable on staging)

1. **Connect:** POST `/api/whatsapp-inbox/auth/api-key` (or byoa) with staging test creds → 200; DB check `select id,status from whatsapp_inbox_accounts where waba_id=$1` shows one `active` row.
2. **List:** GET `/api/tenants/{id}/whatsapp-inbox/accounts` → the account appears, no `accessToken` field in the response.
3. **Simulate inbound:** POST a crafted Meta webhook payload to `/api/webhooks/whatsapp-inbox` with a valid `x-hub-signature-256` (sign the body with `META_APP_SECRET`) for the connected WABA + a `text` message → 200. DB check: `select count(*) from whatsapp_inbox_messages` = 1 (inbound), and the conversation row has `unread_count=1`, `last_message_preview` set, `window_expires_at` ~24h out.
4. **Assign agent + auto-reply:** PATCH the account `{ assignedAgentId, agentAutoReply: true }`; re-POST a simulated inbound; confirm an outbound row appears (`direction='outbound'`) and the core `conversations` table has a row with `external_id = inbox:whatsapp:{accountId}:{contactPhone}`.
5. **Human reply:** POST `/api/tenants/{id}/whatsapp-inbox/accounts/{accountId}/conversations/{contactPhone}/messages` `{ text }` → 201 (window open); a second outbound row appears.
6. **Window-expired:** manually `update whatsapp_inbox_conversations set window_expires_at = now() - interval '1h'`; POST reply → 400 "24-hour".

---

## Slice 5b — Instagram data layer + routes/webhook (parallel to 5a; resolve-agent Instagram branch flips)

**Outcome:** Same end-to-end coverage as 5a, for Instagram. Identical structure; only contact key (`contactIgsid`), message types, and send-API endpoint differ.

### Task 5b.1: Instagram deps + `rowToX` mappers

**Files:**
- Modify: `packages/channel-instagram/package.json` (add `@vibesboard/adapter-postgres`, `drizzle-orm`, `uuidv7` + the `test` script — same as 5a.1 Step 3)
- Create: `packages/channel-instagram/src/db.ts`
- Create: `packages/channel-instagram/src/__tests__/instagram-data.test.ts`

- [ ] **Step 1: Write the failing test** (mirror 5a.2; map `contactIgsid`, types `image|video|story_mention|story_reply|media_share`, IG account fields `instagramAccountId`, `pageId`, `pageName`, `instagramUsername`, `metaUserId`):

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToInstagramAccount, rowToInstagramConversation, rowToInstagramMessage } from '../db.ts'

describe('instagram mappers', () => {
  test('rowToInstagramConversation maps contactIgsid + window', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToInstagramConversation({
      id: 'c1', tenantId: 't1', accountId: 'a1', contactIgsid: '178414',
      contactName: null, contactUsername: 'bob', contactProfilePic: null,
      lastMessageAt: now, lastMessagePreview: 'yo', unreadCount: 1, assignedTo: null,
      assignedAgentId: null, agentPaused: false, agentHandedOff: false,
      agentConversationId: null, status: 'open', windowExpiresAt: now, createdAt: now, updatedAt: now,
    } as any)
    assert.equal(c.contactIgsid, '178414')
    assert.equal(c.contactUsername, 'bob')
    assert.equal(c.windowExpiresAt, '2026-05-25T00:00:00.000Z')
  })

  test('rowToInstagramMessage maps igMessageId', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const m = rowToInstagramMessage({
      id: 'm1', tenantId: 't1', conversationId: 'c1', igMessageId: 'mid.1',
      fromAddr: '178414', toAddr: 'page1', type: 'text', text: 'yo', mediaUrl: null,
      caption: null, direction: 'inbound', status: 'received', sentBy: null,
      sentByAgentName: null, timestampOriginal: now, createdAt: now,
    } as any)
    assert.equal(m.igMessageId, 'mid.1')
    assert.equal(m.from, '178414')
    assert.equal(m.timestamp, '2026-05-25T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd packages/channel-instagram && npm test`

- [ ] **Step 3: Implement `packages/channel-instagram/src/db.ts`**

```ts
import type { InstagramAccount, InstagramConversation, InstagramMessage } from '@vibesboard/adapter-postgres/schema'
import type { InstagramInboxAccountDocument, InstagramInboxConversationDocument, InstagramInboxMessageDocument } from '@vibesboard/contracts'

export const rowToInstagramAccount = (r: InstagramAccount): InstagramInboxAccountDocument => ({
  id: r.id, tenantId: r.tenantId, instagramAccountId: r.instagramAccountId,
  pageId: r.pageId, pageName: r.pageName, instagramUsername: r.instagramUsername,
  accessToken: r.accessTokenEncrypted, scopes: r.scopes ?? [], status: r.status,
  connectedBy: r.connectedBy ?? '', connectedAt: r.connectedAt.toISOString(),
  webhookSubscribed: r.webhookSubscribed, metaUserId: r.metaUserId ?? undefined,
  connectionMethod: r.connectionMethod ?? undefined, metaAppId: r.metaAppId ?? undefined,
  metaAppSecret: r.metaAppSecretEncrypted ?? undefined,
  webhookVerifyToken: r.webhookVerifyTokenEncrypted ?? undefined,
  byoaWebhookUrl: r.byoaWebhookUrl ?? undefined, assignedAgentId: r.assignedAgentId ?? null,
  agentAutoReply: r.agentAutoReply, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
})

export const rowToInstagramConversation = (r: InstagramConversation): InstagramInboxConversationDocument => ({
  id: r.id, accountId: r.accountId, contactIgsid: r.contactIgsid,
  contactName: r.contactName ?? undefined, contactUsername: r.contactUsername ?? undefined,
  contactProfilePic: r.contactProfilePic ?? undefined, lastMessageAt: r.lastMessageAt.toISOString(),
  lastMessagePreview: r.lastMessagePreview, unreadCount: r.unreadCount,
  assignedTo: r.assignedTo ?? undefined, assignedAgentId: r.assignedAgentId ?? null,
  agentPaused: r.agentPaused, agentHandedOff: r.agentHandedOff,
  agentConversationId: r.agentConversationId ?? null, status: r.status,
  windowExpiresAt: r.windowExpiresAt.toISOString(), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
})

export const rowToInstagramMessage = (r: InstagramMessage): InstagramInboxMessageDocument => ({
  id: r.id, igMessageId: r.igMessageId, from: r.fromAddr, to: r.toAddr, type: r.type,
  text: r.text ?? undefined, mediaUrl: r.mediaUrl ?? undefined, caption: r.caption ?? undefined,
  direction: r.direction, status: r.status, timestamp: r.timestampOriginal.toISOString(),
  sentBy: r.sentBy ?? undefined, sentByAgentName: r.sentByAgentName ?? undefined, createdAt: r.createdAt.toISOString(),
})
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd packages/channel-instagram && npm test`
- [ ] **Step 5: Commit**

```bash
git add packages/channel-instagram/package.json packages/channel-instagram/src/db.ts packages/channel-instagram/src/__tests__/instagram-data.test.ts
git commit -m "feat(channel-instagram): pg deps + rowToX mappers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5b.2: Instagram account ops on Postgres

**Files:**
- Modify: `packages/channel-instagram/src/accounts.ts`
- Test: `packages/channel-instagram/src/__tests__/instagram-data.test.ts`

- [ ] **Step 1: Write the failing test** — mirror 5a.3's test exactly but use `instagramAccounts`, `instagramAccountId`/`pageId` fields, and `findAccountByPageId` instead of `findAccountByWabaId`:

```ts
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  createAccountRow, listInboxAccounts, getInboxAccount, disconnectInboxAccount,
  findAccountByPageId, updateAccountAssignment, deleteInboxAccount,
} from '../accounts.ts'

async function seedTenant(adminDb: any) {
  const u = randomUUID(); const t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  return { tenantId: t, userId: u }
}

describe('instagram accounts (pg)', () => {
  test('create / list / get / findByPage / assign / disconnect / delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createAccountRow({
        tenantId, instagramAccountId: 'ig-1', pageId: 'page-1', pageName: 'Page',
        instagramUsername: 'biz', accessTokenEncrypted: 'enc', connectedBy: userId,
        connectionMethod: 'api_key', webhookSubscribed: true, scopes: ['instagram_basic'],
      }, adminDb)
      assert.ok(created.id)
      assert.equal((await listInboxAccounts(tenantId, adminDb)).length, 1)
      assert.equal((await getInboxAccount(tenantId, created.id, adminDb))?.pageId, 'page-1')
      assert.equal((await findAccountByPageId('page-1', adminDb))?.tenantId, tenantId)
      await updateAccountAssignment(tenantId, created.id, { agentAutoReply: true }, adminDb)
      assert.equal((await getInboxAccount(tenantId, created.id, adminDb))?.agentAutoReply, true)
      await disconnectInboxAccount(tenantId, created.id, adminDb)
      assert.equal(await findAccountByPageId('page-1', adminDb), null)
      await deleteInboxAccount(tenantId, created.id, adminDb)
      assert.equal(await getInboxAccount(tenantId, created.id, adminDb), null)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd packages/channel-instagram && npm test`

- [ ] **Step 3: Rewrite `accounts.ts`** — keep ALL Meta Graph fns (`exchangeCodeForToken`, `exchangeForLongLivedToken`, `getPageAccessToken`, `getInstagramAccountForPage`, `subscribeToWebhooks`) and `encryptToken`/`decryptToken` unchanged. Add the same Drizzle storage ops as WhatsApp 5a.3 but for `instagramAccounts` with IG fields. `createAccountRow` params: `{ tenantId, instagramAccountId, pageId, pageName, instagramUsername, accessTokenEncrypted, connectedBy, connectionMethod, webhookSubscribed, scopes, metaUserId?, metaAppId?, metaAppSecretEncrypted?, webhookVerifyTokenEncrypted?, byoaWebhookUrl?, id? }`. `existsActiveInstagramAccount(db, tenantId, instagramAccountId)` replaces the duplicate check. `findAccountByPageId(pageId, db)` and `findByoaAccountById(accountId, db)` query without tenant filter (status active). `deleteInboxAccount(tenantId, accountId, db)` becomes a single `db.delete(instagramAccounts).where(and(eq(tenantId), eq(id)))` — messages/conversations cascade via FK `onDelete: 'cascade'`, so the manual subcollection-batch loop is gone. Rewrite the three `connect*Account` bodies to call the Meta fns + `existsActiveInstagramAccount` + `createAccountRow` (BYOA pre-generates `id` for the webhook URL, same as 5a.3). `getAccountWithToken` mirrors WhatsApp.

- [ ] **Step 4: Run — expect PASS.** Run: `cd packages/channel-instagram && npm test`
- [ ] **Step 5: Commit** (`feat(channel-instagram): account storage on Postgres`)

### Task 5b.3: Instagram conversation ops on Postgres

**Files:**
- Modify: `packages/channel-instagram/src/conversations.ts`
- Test: `packages/channel-instagram/src/__tests__/instagram-data.test.ts`

- [ ] **Step 1: Write the failing test** — mirror 5a.4 but key on `contactIgsid` (no phone normalization; IGSID is used verbatim), `instagramConversations`, and add `updateConversationAgentSettings`:

```ts
import { instagramAccounts } from '@vibesboard/adapter-postgres/schema'
import {
  getOrCreateConversation, listConversations, getConversation as getIgConversation,
  updateConversationStatus, assignConversation, markAsRead, updateConversationAgentSettings,
} from '../conversations.ts'

async function seedAccount(adminDb: any) {
  const { tenantId, userId } = await seedTenant(adminDb)
  const id = randomUUID()
  await adminDb.insert(instagramAccounts).values({
    id, tenantId, instagramAccountId: 'ig', pageId: 'p', pageName: 'P',
    instagramUsername: 'u', accessTokenEncrypted: 'e', scopes: [], connectedBy: userId,
    webhookSubscribed: true, windowExpiresAt: new Date(),
  })
  return { tenantId, accountId: id }
}

describe('instagram conversations (pg)', () => {
  test('getOrCreate idempotent on (account, igsid); status/assign/read/agentSettings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const a = await getOrCreateConversation(tenantId, accountId, '178414', 'Bob', 'bob', adminDb)
      const b = await getOrCreateConversation(tenantId, accountId, '178414', undefined, undefined, adminDb)
      assert.equal(a.id, b.id)
      assert.equal((await listConversations(tenantId, accountId, undefined, adminDb)).length, 1)
      await updateConversationStatus(tenantId, accountId, '178414', 'resolved', adminDb)
      await assignConversation(tenantId, accountId, '178414', null, adminDb)
      await markAsRead(tenantId, accountId, '178414', adminDb)
      await updateConversationAgentSettings(tenantId, accountId, '178414', { agentPaused: true }, adminDb)
      const c = await getIgConversation(tenantId, accountId, '178414', adminDb)
      assert.equal(c?.status, 'resolved'); assert.equal(c?.unreadCount, 0); assert.equal(c?.agentPaused, true)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Rewrite `conversations.ts`** — same shape as 5a.4 for `instagramConversations`, conflict target `[instagramConversations.accountId, instagramConversations.contactIgsid]`. `getOrCreateConversation(tenantId, accountId, contactIgsid, contactName?, contactUsername?, db)` sets `contactIgsid`, `contactName`, `contactUsername` (no normalization). Include `updateConversationAgentSettings`. Lookups filter on `contactIgsid` verbatim.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(channel-instagram): conversation ops on Postgres`)

### Task 5b.4: Instagram message ops on Postgres

**Files:**
- Modify: `packages/channel-instagram/src/messages.ts`
- Test: `packages/channel-instagram/src/__tests__/instagram-data.test.ts`

- [ ] **Step 1: Write the failing test** — mirror 5a.5 with `persistInboundMessage`/`persistOutboundMessage`, `igMessageId`, `instagramMessages`. Outbound `from = account.pageId`, `to = contactIgsid`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Rewrite `messages.ts`** — keep the unchanged attachment/type-derivation block and the unchanged Meta send `fetch` to `${META_GRAPH_API}/me/messages` with `recipient: { id: contactIgsid }`. `storeInboundMessage` calls `getOrCreateConversation(tenantId, accountId, contactIgsid, contactName, contactUsername, db)` then `persistInboundMessage`. `sendReply` mirrors WhatsApp (window check + persistOutbound). `listMessages` resolves the convo by `contactIgsid` then queries `instagramMessages` ordered by `timestampOriginal asc`. `updateMessageStatus(igMessageId, status, _ts, db)` mirrors WhatsApp (lookup by `igMessageId`, `direction='outbound'`, monotonic guard).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(channel-instagram): message ops on Postgres`)

### Task 5b.5: Wire Instagram connect-flows + routes; resolve-agent Instagram branch → Postgres

**Files:**
- Modify: `packages/channel-instagram/src/accounts.ts` (finish connect bodies)
- Modify: `apps/web/app/api/tenants/[id]/instagram-inbox/accounts/[accountId]/route.ts`
- Modify: `apps/web/app/api/tenants/[id]/instagram-inbox/accounts/[accountId]/conversations/[contactId]/route.ts`
- Modify: `packages/inbox/src/resolve-agent.ts`

- [ ] **Step 1: account PATCH route → `updateAccountAssignment`** (same shape as 5a.6 Step 1). Remove `adminDb`/`Collections`.
- [ ] **Step 2: per-conversation route → `updateConversationStatus`/`assignConversation`/`markAsRead`/`updateConversationAgentSettings`.** Remove `adminDb`/`Collections`.
- [ ] **Step 3: resolve-agent — replace the Instagram `else` branch with channel helpers:**

```ts
import * as ig from '@vibesboard/channel-instagram/conversations'
import * as igAcc from '@vibesboard/channel-instagram/accounts'
// in the else (instagram) branch:
const convo = await ig.getConversation(tenantId, accountId, contactId)
if (convo?.agentPaused || convo?.agentHandedOff) return null
let agentId = convo?.assignedAgentId ?? undefined
if (!agentId) {
  const account = await igAcc.getInboxAccount(tenantId, accountId)
  if (!account) return null
  if (account.agentAutoReply === false) return null
  agentId = account.assignedAgentId ?? undefined
}
if (!agentId) return null
const agent = await getAgentForMember(tenantId, agentId)
return agent ? { agentId, agent } : null
```

Now resolve-agent has NO `adminDb` import — remove `import { adminDb }`, `Collections`, and the four inbox-doc-type imports. Both channels resolve from Postgres.

- [ ] **Step 4: Build.** Run: `cd packages/channel-instagram && npm test && cd ../inbox && npm run type-check && cd ../../apps/web && npm run build`
Expected: PASS / typechecks; `grep -rn "adminDb" packages/inbox/src/resolve-agent.ts apps/web/app/api/tenants/\[id\]/instagram-inbox` is empty.
- [ ] **Step 5: Commit** (`feat(web,inbox): instagram inbox routes + resolve-agent fully on Postgres`)

### Slice 5b staging e2e (API-level)

Repeat 5a's six steps against the Instagram routes: connect via `/api/instagram-inbox/auth/api-key`; list; simulate inbound POST to `/api/webhooks/instagram-inbox` (sign with `META_APP_SECRET`, IG message envelope with `sender.id` IGSID); assign agent + auto-reply; human reply via the IG messages route; window-expired 400. DB checks against `instagram_inbox_*` tables + the core `conversations` row with `external_id = inbox:instagram:{accountId}:{igsid}`.

---

## Slice 5c — Chatwoot connections + reply route

**Outcome:** Creating/listing/disconnecting/deleting Chatwoot connections, the inbound Chatwoot webhook connection lookup + stats, and the human reply route's connection lookup all run on Postgres. (Reply-route `getConversation`/`updateConversationMessages` were already Postgres in Phase 4.)

### Task 5c.1: Chatwoot deps + `rowToChatwootConnection` mapper

**Files:**
- Modify: `packages/channel-chatwoot/package.json` (add `@vibesboard/adapter-postgres`, `drizzle-orm`, `uuidv7` + `test` script)
- Create: `packages/channel-chatwoot/src/db.ts`
- Create: `packages/channel-chatwoot/src/__tests__/connections.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToChatwootConnection } from '../db.ts'

describe('chatwoot mapper', () => {
  test('remaps encrypted token column names to legacy doc fields', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const c = rowToChatwootConnection({
      id: 'c1', tenantId: 't1', agentId: 'ag1', userId: 'u1', chatwootUrl: 'https://x',
      chatwootAccountId: 7, chatwootInboxId: 3, chatwootInboxName: 'Inbox',
      apiTokenEncrypted: 'apiEnc', chatwootWebhookId: 9, agentBotId: 2, agentBotName: 'Bot',
      botTokenEncrypted: 'botEnc', useAgentBot: true, webhookSecretHash: 'hash', status: 'active',
      lastMessageReceivedAt: null, totalConversations: 5, disconnectedAt: null,
      disconnectionReason: null, errorMessage: null, createdAt: now, updatedAt: now,
    } as any)
    assert.equal(c.encryptedApiToken, 'apiEnc')
    assert.equal(c.encryptedBotToken, 'botEnc')
    assert.equal(c.webhookSecretHash, 'hash')
    assert.equal(c.totalConversations, 5)
    assert.equal(c.useAgentBot, true)
    assert.equal(c.createdAt, '2026-05-25T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd packages/channel-chatwoot && npm test`

- [ ] **Step 3: Implement `packages/channel-chatwoot/src/db.ts`**

```ts
import type { ChatwootConnection } from '@vibesboard/adapter-postgres/schema'
import type { ChatwootConnectionDocument } from '@vibesboard/contracts'

export const rowToChatwootConnection = (r: ChatwootConnection): ChatwootConnectionDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  userId: r.userId ?? '',
  chatwootUrl: r.chatwootUrl,
  chatwootAccountId: r.chatwootAccountId,
  chatwootInboxId: r.chatwootInboxId,
  chatwootInboxName: r.chatwootInboxName,
  encryptedApiToken: r.apiTokenEncrypted,
  chatwootWebhookId: r.chatwootWebhookId ?? null,
  agentBotId: r.agentBotId ?? null,
  agentBotName: r.agentBotName ?? null,
  encryptedBotToken: r.botTokenEncrypted ?? null,
  useAgentBot: r.useAgentBot,
  webhookSecretHash: r.webhookSecretHash,
  status: r.status,
  lastMessageReceivedAt: r.lastMessageReceivedAt ? r.lastMessageReceivedAt.toISOString() : undefined,
  totalConversations: r.totalConversations,
  disconnectedAt: r.disconnectedAt ? r.disconnectedAt.toISOString() : undefined,
  disconnectionReason: r.disconnectionReason ?? undefined,
  errorMessage: r.errorMessage ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
```

(Verify the exact optional fields on `ChatwootConnectionDocument` in `packages/contracts/src/firestore-types.ts` lines ~560-598 and match them; if a field there is required, map it non-optionally.)

- [ ] **Step 4: Run — expect PASS.** Run: `cd packages/channel-chatwoot && npm test`
- [ ] **Step 5: Commit** (`feat(channel-chatwoot): pg deps + rowToChatwootConnection mapper`)

### Task 5c.2: Chatwoot connection CRUD + stats + by-id lookup on Postgres

**Files:**
- Modify: `packages/channel-chatwoot/src/connections.ts`
- Test: `packages/channel-chatwoot/src/__tests__/connections.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  createChatwootConnection, listChatwootConnections, getChatwootConnection,
  getChatwootConnectionById, disconnectChatwootConnection, deleteChatwootConnection,
  updateConnectionStats, generateWebhookSecret, verifyWebhookSecret,
} from '../connections.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0,8)}`, instructions: 'ok ok ok' })
  return { tenantId: t, agentId: a, userId: u }
}

describe('chatwoot connections (pg)', () => {
  test('create / list / getById (cross-tenant) / disconnect / delete / stats', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const secret = generateWebhookSecret()
      const { connection } = await createChatwootConnection(tenantId, agentId, {
        chatwootUrl: 'https://cw.example.com/', apiToken: 'tok', accountId: 7, inboxId: 3,
        inboxName: 'Inbox', chatwootWebhookId: 9, webhookSecret: secret, useAgentBot: false,
      }, userId, undefined, adminDb)
      assert.ok(connection.id)
      assert.notEqual(connection.encryptedApiToken, 'tok') // encrypted
      assert.equal(connection.chatwootUrl, 'https://cw.example.com') // trailing slash stripped

      const list = await listChatwootConnections(tenantId, agentId, 'active', adminDb)
      assert.equal(list.length, 1)

      const byId = await getChatwootConnectionById(connection.id, adminDb)
      assert.equal(byId?.tenantId, tenantId)
      assert.ok(verifyWebhookSecret(secret, byId!.webhookSecretHash))

      await updateConnectionStats(tenantId, agentId, connection.id, adminDb)
      const afterStats = await getChatwootConnection(tenantId, agentId, connection.id, adminDb)
      assert.equal(afterStats?.totalConversations, 1)

      await disconnectChatwootConnection(tenantId, agentId, connection.id, 'manual', adminDb)
      assert.equal(await getChatwootConnectionById(connection.id, adminDb), null) // only active
      await deleteChatwootConnection(tenantId, agentId, connection.id, adminDb)
      assert.equal(await getChatwootConnection(tenantId, agentId, connection.id, adminDb), null)
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd packages/channel-chatwoot && npm test`

- [ ] **Step 3: Rewrite `connections.ts` storage**

Keep `genId`/`genSecret`, `encryptToken`/`decryptToken`, `hashSecret`/`verifyWebhookSecret`, `generateConnectionId`/`generateWebhookSecret` unchanged (drop the unused `customAlphabet` id only if you switch PKs to uuid). New header + ops (note `updateConnectionStats` must now be **async with a `db` param** — the current fire-and-forget void signature changes; update the one caller in `agent-handler.ts` to `void updateConnectionStats(...)` which still doesn't await the returned promise):

```ts
import { and, eq, desc, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { chatwootConnections } from '@vibesboard/adapter-postgres/schema'
import { rowToChatwootConnection } from './db.ts'
import type { ChatwootConnectionDocument, ChatwootConnectionStatus } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

export async function createChatwootConnection(
  tenantId: string, agentId: string, params: CreateChatwootConnectionParams,
  userId: string, connectionId?: string, db: Db = getMigrateDb(),
): Promise<CreatedChatwootConnection> {
  const id = connectionId && /^[0-9a-f-]{36}$/i.test(connectionId) ? connectionId : uuidv7()
  const [row] = await db.insert(chatwootConnections).values({
    id, tenantId, agentId, userId,
    chatwootUrl: params.chatwootUrl.replace(/\/+$/, ''),
    chatwootAccountId: params.accountId, chatwootInboxId: params.inboxId,
    chatwootInboxName: params.inboxName, apiTokenEncrypted: encryptToken(params.apiToken),
    chatwootWebhookId: params.chatwootWebhookId ?? null, agentBotId: params.agentBotId ?? null,
    agentBotName: params.agentBotName ?? null,
    botTokenEncrypted: params.botToken ? encryptToken(params.botToken) : null,
    useAgentBot: params.useAgentBot ?? false, webhookSecretHash: hashSecret(params.webhookSecret),
    status: 'active', totalConversations: 0,
  }).returning()
  return { connection: rowToChatwootConnection(row), webhookSecret: params.webhookSecret }
}

export async function getChatwootConnectionById(connectionId: string, db: Db = getMigrateDb()): Promise<ChatwootConnectionDocument | null> {
  const [row] = await db.select().from(chatwootConnections)
    .where(and(eq(chatwootConnections.id, connectionId), eq(chatwootConnections.status, 'active'))).limit(1)
  return row ? rowToChatwootConnection(row) : null
}

export async function getChatwootConnection(tenantId: string, agentId: string, connectionId: string, db: Db = getMigrateDb()): Promise<ChatwootConnectionDocument | null> {
  const [row] = await db.select().from(chatwootConnections)
    .where(and(eq(chatwootConnections.tenantId, tenantId), eq(chatwootConnections.agentId, agentId), eq(chatwootConnections.id, connectionId))).limit(1)
  return row ? rowToChatwootConnection(row) : null
}

export async function listChatwootConnections(tenantId: string, agentId: string, status?: ChatwootConnectionStatus, db: Db = getMigrateDb()): Promise<ChatwootConnectionDocument[]> {
  const conds = [eq(chatwootConnections.tenantId, tenantId), eq(chatwootConnections.agentId, agentId)]
  if (status) conds.push(eq(chatwootConnections.status, status))
  const rows = await db.select().from(chatwootConnections).where(and(...conds)).orderBy(desc(chatwootConnections.createdAt))
  return rows.map(rowToChatwootConnection)
}

export async function disconnectChatwootConnection(tenantId: string, agentId: string, connectionId: string, reason?: string, db: Db = getMigrateDb()): Promise<void> {
  const now = new Date()
  await db.update(chatwootConnections).set({ status: 'disconnected', disconnectedAt: now, disconnectionReason: reason ?? null, updatedAt: now })
    .where(and(eq(chatwootConnections.tenantId, tenantId), eq(chatwootConnections.agentId, agentId), eq(chatwootConnections.id, connectionId)))
}

export async function deleteChatwootConnection(tenantId: string, agentId: string, connectionId: string, db: Db = getMigrateDb()): Promise<void> {
  await db.delete(chatwootConnections)
    .where(and(eq(chatwootConnections.tenantId, tenantId), eq(chatwootConnections.agentId, agentId), eq(chatwootConnections.id, connectionId)))
}

export async function updateConnectionStats(tenantId: string, agentId: string, connectionId: string, db: Db = getMigrateDb()): Promise<void> {
  await db.update(chatwootConnections).set({
    totalConversations: sql`${chatwootConnections.totalConversations} + 1`,
    lastMessageReceivedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(chatwootConnections.tenantId, tenantId), eq(chatwootConnections.agentId, agentId), eq(chatwootConnections.id, connectionId)))
}
```

Update `packages/channel-chatwoot/src/agent-handler.ts`: the existing call `updateConnectionStats(connection.tenantId, connection.agentId, connection.id)` becomes `void updateConnectionStats(connection.tenantId, connection.agentId, connection.id).catch(err => console.error('[chatwoot] Failed to update connection stats:', err))` (preserve fire-and-forget).

- [ ] **Step 4: Run — expect PASS.** Run: `cd packages/channel-chatwoot && npm test`
- [ ] **Step 5: Commit** (`feat(channel-chatwoot): connection CRUD + stats on Postgres`)

### Task 5c.3: Chatwoot route consumers — replace raw `adminDb` validation reads

**Files:**
- Modify: `apps/web/app/api/agents/[id]/chatwoot/connections/route.ts`
- Modify: `apps/web/app/api/agents/[id]/chatwoot/connections/[connectionId]/route.ts`
- Modify: `apps/web/app/api/agents/[id]/chatwoot/validate/route.ts`
- Verify: `apps/web/app/api/agents/[id]/integrations/status/route.ts` (dynamic-imports `listChatwootConnections` — now Postgres, no change)
- Verify: `apps/web/app/api/agents/[id]/conversations/[cid]/reply/route.ts` (no change — uses `listChatwootConnections`/`decryptToken`, both Postgres now)

- [ ] **Step 1: Identify the raw `adminDb` reads.** In `connections/route.ts:38`, `connections/[connectionId]/route.ts:26`, `validate/route.ts:27` there are direct `adminDb.collection(...)` lookups (likely loading the agent doc or a connection doc). Read each and determine what it fetches. If it loads the **agent** for an auth/ownership check, replace with `getAgentById`/`getAgentForMember` from `@vibesboard/agents/server` (already Postgres). If it loads a **connection**, replace with `getChatwootConnection`/`getChatwootConnectionById`. Run:

Run: `grep -n "adminDb" "apps/web/app/api/agents/[id]/chatwoot/connections/route.ts" "apps/web/app/api/agents/[id]/chatwoot/connections/[connectionId]/route.ts" "apps/web/app/api/agents/[id]/chatwoot/validate/route.ts"`

- [ ] **Step 2: Replace each `adminDb` read** with the corresponding Postgres helper call (agent → `getAgentById`; connection → `getChatwootConnection(agent.tenantId, agentId, connectionId)`). Remove the `adminDb`/`Collections` imports from all three files. Keep all `api-client` calls and `createChatwootConnection`/`disconnectChatwootConnection`/`deleteChatwootConnection` calls (now Postgres, signatures backward-compatible).

- [ ] **Step 3: Build.** Run: `cd apps/web && npm run build`
Expected: typechecks; `grep -rn "adminDb" apps/web/app/api/agents/\[id\]/chatwoot` is empty.

- [ ] **Step 4: Commit** (`feat(web): chatwoot connection routes + reply route on Postgres`)

### Slice 5c staging e2e (API-level)

1. **Create connection:** POST `/api/agents/{id}/chatwoot/connections` with staging Chatwoot creds → 201; DB check `select id,status,total_conversations from chatwoot_connections where agent_id=$1` shows one `active` row, `total_conversations=0`. Note the returned `webhookSecret`.
2. **List + status:** GET `/api/agents/{id}/chatwoot/connections` → connection present; GET `/api/agents/{id}/integrations/status` → chatwoot shows connected.
3. **Simulate inbound webhook:** POST `/api/webhooks/chatwoot/{connectionId}?secret={webhookSecret}` with a `message_created` / `message_type: incoming` payload → 200. Confirm `total_conversations` incremented and `last_message_received_at` set; the core `conversations` table has a row with `external_id = chatwoot:{accountId}:{convId}`.
4. **Human reply:** POST `/api/agents/{id}/conversations/{cid}/reply` `{ text }` for that chatwoot conversation → 201; an assistant message is appended in the core `messages` table.
5. **Disconnect + delete:** DELETE the connection → row gone (or `status='disconnected'` then hard-deleted per route); `getChatwootConnectionById` returns null.

---

## Slice 5d — Inbox handler write-backs (handoff + agent-conversation link)

**Outcome:** The inbox agent handler's two remaining Firestore writes (set `agentHandedOff`, set `agentConversationId` on the channel conversation) move to Postgres helpers, removing the last `adminDb` usage from the inbox package. The full inbound→reply→handoff path is now 100% Postgres for both WhatsApp and Instagram.

### Task 5d.1: channel `setConversationHandoff` + `linkAgentConversation` helpers

**Files:**
- Modify: `packages/channel-whatsapp/src/conversations.ts`
- Modify: `packages/channel-instagram/src/conversations.ts`
- Test: `packages/channel-whatsapp/src/__tests__/whatsapp-data.test.ts`, `packages/channel-instagram/src/__tests__/instagram-data.test.ts`

- [ ] **Step 1: Write the failing tests (append to each channel's conversations describe)**

WhatsApp:

```ts
import { setConversationHandoff, linkAgentConversation } from '../conversations.ts'
import { whatsappConversations as waConv } from '@vibesboard/adapter-postgres/schema'

describe('whatsapp handoff + link (pg)', () => {
  test('setConversationHandoff + linkAgentConversation by id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, accountId } = await seedAccount(adminDb)
      const convo = await getOrCreateConversation(tenantId, accountId, '15551234', 'A', adminDb)
      await setConversationHandoff(tenantId, convo.id, true, adminDb)
      await linkAgentConversation(tenantId, convo.id, 'agent-conv-uuid', adminDb)
      const [row] = await adminDb.select().from(waConv).where(eq(waConv.id, convo.id))
      assert.equal(row.agentHandedOff, true)
      assert.equal(row.agentConversationId, 'agent-conv-uuid')
    })
  })
})
```

(`agent-conv-uuid` must be a real uuid in the test — generate `const acid = randomUUID()` and insert a matching row into the core `conversations` table first, since `agent_conversation_id` FK-references `conversations.id` with `onDelete: 'set null'`. Seed: `await adminDb.insert(conversations).values({ id: acid, tenantId, agentId: <a real agent> })` — extend `seedAccount` to also create an agent, or add a standalone agent+conversation in this test.)

Instagram: identical, keyed by the IG conversation row id, using `instagramConversations`.

- [ ] **Step 2: Run — expect FAIL.** Run: `cd packages/channel-whatsapp && npm test`

- [ ] **Step 3: Implement in each `conversations.ts`** (these take the **row id**, not contactPhone, because the handler has the row id from the conversation it fetched):

```ts
export async function setConversationHandoff(
  tenantId: string, conversationId: string, handedOff: boolean, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappConversations).set({ agentHandedOff: handedOff, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.id, conversationId)))
}

export async function linkAgentConversation(
  tenantId: string, conversationId: string, agentConversationId: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(whatsappConversations).set({ agentConversationId, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.tenantId, tenantId), eq(whatsappConversations.id, conversationId)))
}
```

(Instagram: same against `instagramConversations`.)

- [ ] **Step 4: Run — expect PASS.** Run: `cd packages/channel-whatsapp && npm test && cd ../channel-instagram && npm test`
- [ ] **Step 5: Commit** (`feat(channels): setConversationHandoff + linkAgentConversation helpers`)

### Task 5d.2: handler write-backs → Postgres; remove `adminDb` from inbox

**Files:**
- Modify: `packages/inbox/src/handler.ts`
- Modify: `packages/inbox/src/inbox-agent.test.ts` (update to Postgres harness)
- Modify: `packages/inbox/package.json` (add `@vibesboard/adapter-postgres` dep; the existing `test` script lacks `--conditions react-server` — add it so `@vibesboard/agents/conversations` resolves under the same export condition used by its tests)

- [ ] **Step 1: Inspect the existing test.** Run: `grep -n "adminDb\|withTestDb\|triggerInboxAgent\|resolveInboxAgent" packages/inbox/src/inbox-agent.test.ts` to see what it currently asserts (likely mocks resolve/reply). Keep its existing seams; only swap any Firestore assertion for a Postgres one.

- [ ] **Step 2: Rewrite the handler's two write-backs.** In `handler.ts`, the handler currently fetches the channel `contactId` and does raw `adminDb.collection(convoPath).doc(contactId).update(...)` twice. It now needs the **channel conversation row id**. Resolve it once near the top of `handleInboxAgentMessage` via the channel helper:

```ts
import * as wa from '@vibesboard/channel-whatsapp/conversations'
import * as ig from '@vibesboard/channel-instagram/conversations'
// ...
const channelConvo =
  channel === 'whatsapp'
    ? await wa.getConversation(tenantId, accountId, contactId)
    : await ig.getConversation(tenantId, accountId, contactId)
const channelConvoId = channelConvo?.id ?? null
```

Replace the handoff write (step 9):

```ts
if (channelConvoId) {
  if (channel === 'whatsapp') await wa.setConversationHandoff(tenantId, channelConvoId, true)
  else await ig.setConversationHandoff(tenantId, channelConvoId, true)
}
```

Replace the link write (step 10):

```ts
if (conversation.messages.length <= 1 && channelConvoId) {
  try {
    if (channel === 'whatsapp') await wa.linkAgentConversation(tenantId, channelConvoId, conversation.id)
    else await ig.linkAgentConversation(tenantId, channelConvoId, conversation.id)
  } catch { /* non-critical */ }
}
```

Remove the `import { adminDb }` and `import { Collections }` lines and the `convoPath` computations. Everything else (`isConversationHandedOff`, `ensureConversation`, `updateConversationMessages`, `maybeAutoSummarize`, `markConversationHandedOff`, notifications, the reply-adapter call) is unchanged — already Postgres from Phase 4 / slices 5a-5b.

- [ ] **Step 3: Update `packages/inbox/package.json`.** Add `"@vibesboard/adapter-postgres": "workspace:*"` to dependencies; change the `test` script to include `--conditions react-server`:

```json
"test": "node --experimental-strip-types --conditions react-server --test --experimental-test-isolation=none 'src/**/*.test.ts'"
```

- [ ] **Step 4: Run + build.** Run: `pnpm install && cd packages/inbox && npm test && npm run type-check && cd ../../apps/web && npm run build`
Expected: PASS / typechecks; `grep -rn "adminDb" packages/inbox/src` is empty.

- [ ] **Step 5: Commit** (`feat(inbox): handler write-backs on Postgres; remove adminDb`)

### Slice 5d staging e2e (API-level)

1. **Handoff write-back:** With a WhatsApp account assigned to an agent + auto-reply on, POST a simulated inbound whose content triggers `[HANDOFF_TO_HUMAN]` (e.g. "I want to talk to a human"). After processing: DB check `select agent_handed_off, agent_conversation_id from whatsapp_inbox_conversations where account_id=$1 and contact_phone=$2` → `agent_handed_off=true`, `agent_conversation_id` set to the core conversation id. The core `conversations.handed_off` is also true (Phase 4 `markConversationHandedOff`).
2. **Link on first message:** For a fresh contact, POST one simulated inbound (no handoff) → `agent_conversation_id` is populated after the first reply, and the core `conversations` row exists with `external_id = inbox:whatsapp:{accountId}:{contactPhone}`.
3. **Skip when handed off:** POST a second inbound to the handed-off conversation → no new outbound row (handler returns early via `isConversationHandedOff`).
4. Repeat 1-3 for Instagram against `instagram_inbox_conversations`.
5. **Full regression:** confirm slices 5a/5b/5c e2e steps still pass (no `adminDb` left anywhere under `packages/channel-*` or `packages/inbox`: `grep -rln adminDb packages/channel-whatsapp/src packages/channel-instagram/src packages/channel-chatwoot/src packages/inbox/src` → only the connect-flow files if any residual; should be empty).

---

## Self-Review

**1. Spec coverage (Phase 5 row: collections `whatsappInbox*`, `instagramInbox*`, `chatwootConnections`; call-sites `channel-whatsapp/*`, `channel-instagram/*`, `channel-chatwoot/*`, `inbox/handler`, `tenants/[id]/{whatsapp,instagram}-inbox/*`; plus the brief's resolve-agent + reply route).**
- WhatsApp accounts/conversations/messages → 5a.2-5a.5; routes/webhook → 5a.6. ✔
- Instagram accounts/conversations/messages → 5b.1-5b.4; routes/webhook → 5b.5. ✔
- `chatwootConnections` (connection-only, no inbox tables) → 5c.1-5c.2; route consumers + reply route → 5c.3. ✔
- `inbox/resolve-agent` → migrated WhatsApp branch in 5a.6, Instagram branch in 5b.5 (decision 8: read forward into channel helpers so no mid-path split). ✔
- `inbox/handler` → write-backs in 5d.2; the ensure/update/handoff conversation calls were already Postgres in Phase 4. ✔
- Webhook ingestion path coherence (Phase 3 lesson) → decisions 7-8 + each slice e2e drives the full inbound→reply path; each channel's path is whole within its slice. ✔
- TOCTOU on inbound races → decision 2 + 5a.1 unique constraint + ON CONFLICT upsert (invite-code lesson). ✔
- Channel tables vs core `conversations` table relation clarified (decision 9 + architecture): fully separate `*_inbox_*` tables; agent transcript in core `conversations` linked via `agent_conversation_id`. ✔
- Schema gap found + migration proposed (decision 2 / 5a.1): the schema had only a non-unique `(account, contact)` index; the Firestore doc-id-as-contact idempotency needed a unique constraint → migration `0007`. This is the one genuine schema change; all other columns/enums/FKs matched the existing schema exactly (verified against `channels.ts`). ✔
- RLS: channel tables already have tenant policies (`drizzle/0001`); webhook helpers correctly use `getMigrateDb()` (BYPASSRLS) per the identity-ops precedent because ingestion runs before tenant GUC context. ✔
- New package deps + `test` scripts (channels had none) → 5a.1, 5b.1, 5c.1, 5d.2. ✔

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N without code". The one explicit "placeholder removed in 5b" note in 5a.6 Step 3 is immediately corrected by the IMPORTANT instruction to keep the original Instagram `adminDb` code in the `else` branch (no throw shipped). Instagram tasks 5b.3/5b.4 say "mirror 5a.4/5a.5" but give the full divergent test code and enumerate every behavioral difference (contact key, no normalization, send endpoint, from/to) so they are implementable without cross-referencing — the shared mechanical body is identical Drizzle and the differences are spelled out. 5c.3 reads each `adminDb` site before replacing (correct: the exact replacement depends on what each fetches; the decision rule agent-vs-connection is explicit). Token field renames fully specified (decision 3 + mapper). `updateConnectionStats` signature change + its single caller update is called out.

**3. Type consistency:** All helpers use `(args..., db: Db = getMigrateDb())`; `Db = PostgresJsDatabase<typeof schema>` defined per file. `rowToWhatsappAccount`/`rowToWhatsappConversation`/`rowToWhatsappMessage`, `rowToInstagram*`, `rowToChatwootConnection` map to the legacy `*Document` interfaces verified against `firestore-types.ts` (enums `InboxAccountStatus`/`InboxConversationStatus`/`InboxMessageStatus`/`ChatwootConnectionStatus` match the schema text-enum columns exactly). Timestamps via `.toISOString()`. `getOrCreateConversation` signatures keep `contactPhone`/`contactIgsid` (callers unchanged); write-back helpers take the row `id` (handler has it) — naming `setConversationHandoff`/`linkAgentConversation` used consistently in 5d.1 and 5d.2. Chatwoot column names (`apiTokenEncrypted`/`botTokenEncrypted`/`webhookSecretHash`) vs doc fields (`encryptedApiToken`/`encryptedBotToken`/`webhookSecretHash`) reconciled only inside the mapper; all consumers read the doc-shape fields.

**Gaps fixed inline during review:** (a) added the `agent_conversation_id` FK seeding requirement to the 5d.1 test (it references `conversations.id`); (b) noted `windowExpiresAt` NOT NULL must be set on every conversation create; (c) flagged `updateConnectionStats` becoming async and its caller update in `agent-handler.ts`; (d) added `--conditions react-server` to the inbox test script (5d.2) so `@vibesboard/agents/conversations` resolves.
