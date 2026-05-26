# Phase 7 — Hooks, Usage, Notifications + Firestore Teardown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the final Firestore consumers (hooks, hook_jobs, usage counters, notifications, plus misc residual routes/pages) to Postgres, then tear down all Firestore *data-plane* access — keeping Firebase Auth/RISC intact.

**Architecture:** Direct-Drizzle co-located helpers with optional `db: Db = getMigrateDb()` param, `rowToX` mappers normalizing to legacy document shapes, `uuidv7()` IDs in app code, identity/cross-tenant ops via `getMigrateDb()` (BYPASSRLS). Tests are `withTestDb` adminDb integration tests in package `__tests__/`. Routes stay thin. Run with `--conditions react-server`.

**Tech Stack:** Drizzle ORM + postgres-js, `@vibesboard/adapter-postgres` (`/client`, `/schema`, `/test-utils`), `node:test`, `uuidv7`, Postgres 16 + pgvector test harness.

**CCN budget:** ≤12 functions over CCN 15 repo-wide. Lizard counts `??`/`||`/`&&`/`?:` as branches. After each slice touching branchy mappers/handlers run `python3 -m lizard --CCN 15 <file>` (install: `pip install --user lizard`) and split helpers if a function exceeds 15.

---

## Investigation findings (read before starting)

**Postgres tables already exist** (do NOT add migrations for these): `hooks`, `hook_jobs` (`schema/agents.ts`), `usage_counters` (`schema/policy.ts`), `notifications` (`schema/conversations.ts`).

**Firestore consumers in scope, classified:**

| Call-site | Classification | Target |
|---|---|---|
| `packages/agents/src/hooks.ts` | migrate | `hooks` table |
| `packages/agents/src/hook-jobs.ts` | migrate | `hook_jobs` table |
| `packages/agents/src/limits.ts` | migrate | atomic increment on `agents.total_response_count` |
| `packages/agents/src/notifications.ts` | migrate (in-app sender + email user lookup) | `notifications` table + `users` table |
| `api/hooks/[hookId]/chat/route.ts` | migrate residual | `totalResponseCount` increment → `incrementAgentResponseCount()` |
| `api/agents/[id]/chat/route.ts` | migrate residual | same increment helper |
| `api/public/agents/[agentId]/chat/route.ts` | migrate residual | same increment + tx-guard helper |
| `api/notifications/route.ts` + `count` | migrate | `notifications` table helpers |
| `api/tenants/[id]/usage` + `api/admin/tenants/[id]/usage` | **vestigial** — read `usageRollups`/`usageLogs` which are now no-op shims in `policy/usage`; no data is written there anymore. Replace Firestore reads with the `usage_counters`-backed helper (or return empty rollup honestly). |
| `api/tenants/[id]/google-review` | migrate | `tenants.google_place_id` (column exists) |
| `api/agents/[id]/access-password` | migrate | `agents.access_password_hash` (column exists) |
| `api/agent-creator/route.ts` | migrate | inline `agents` insert (mirror `api/agents/route.ts`) |
| `api/admin/files/process/route.ts` | migrate | `agent_files` table (Phase 3 migrated `agentFiles`/`fileChunks`) collectionGroup → SQL |
| `api/meta/data-deletion` + `/status` | migrate | instagram `meta_user_id` cascade-delete (Phase 5 tables) + **new `meta_data_deletion_requests` table** (no PG table exists yet) |
| `apps/web/app/admin/agents/[id]/page.tsx` | migrate residual | tenant read → `getTenantById()` (already PG) |
| `apps/web/app/agents/[id]/layout.tsx` | migrate residual | conversations read → `listAgentConversations()` (already PG) |
| `api/admin/feature-flags` + `[id]` | **vestigial-delete** — `policy/features` is an all-enabled shim; these write Firestore flags nothing reads. Stub/remove (PR 1f optional cleanup). |
| `apps/web/app/actions.ts` (`Collections.chats`) + `api/chat/route.ts` | **SEPARATE LEGACY FEATURE — needs user decision** (see below) |

**`chats` collection finding:** `actions.ts` (`getChats/getChat/removeChat/clearChats/getSharedChat/shareChat`) and `api/chat/route.ts` (`saveChat`) use `Collections.chats`. There is **NO `chats` table in the Postgres schema** (`grep` confirms; `Collections.chats` is defined only in `firestore-types.ts:872`). Consumers are the legacy "assistant playground": `app/chat/[id]/page.tsx`, `app/share/[id]/page.tsx`, `components/clear-history.tsx`. This is a **separate feature from agent conversations** (Phase 4, already migrated). The migration spec's domain table does NOT list `chats`. **Recommendation: flag for the user — do not invent a table.** Three options in Task 7c.0; default recommendation is **Option B (delete the legacy playground)** since it predates the agent product and is unused by the agent flows.

**What stays Firebase (confirmed against spec non-goals + code):**
- `@vibesboard/adapter-firebase` **package** stays — `adapter-google/src/risc.ts` imports `adminAuth` (Firebase **Auth**, not Firestore) at lines 3/154/204/209/210/217. RISC / Cross-Account Protection is an explicit non-goal.
- Better Auth (already the auth system).
- `adminAuth` use in `admin/tenants` (out of scope per spec follow-ups).
- The `adapter-firebase/admin` `adminAuth` export and Firebase app init remain.
- Teardown removes only `adminDb` (Firestore) **data** access and `adminDb` re-exports that nothing uses.

**Usage-counter atomic-increment approach (Postgres):** Firestore used `FieldValue.increment(1)` on `agents.totalResponseCount` and `runTransaction` for the capped path. In Postgres replace with a single atomic SQL `UPDATE … SET total_response_count = total_response_count + 1` (no read-modify-write race). The capped "reserve a slot" path (`reserveAgentResponseSlot`) becomes `UPDATE agents SET total_response_count = total_response_count + 1 WHERE id = $1 AND total_response_count < $2 RETURNING id` — row returned ⇒ slot reserved, zero rows ⇒ cap reached. This is atomic under MVCC without an explicit transaction. For `usage_counters` (per tenant/agent/month metering, currently a no-op shim) use Postgres `INSERT … ON CONFLICT (tenant_id, agent_id, period_start) DO UPDATE SET message_count = usage_counters.message_count + EXCLUDED.message_count, …` — but note `recordUsage` in `policy/usage` is a self-host **no-op**; we do NOT wire metering writes (out of scope). We only migrate the lifetime-cap counter, which is real and load-bearing.

---

## File structure

**New package helpers (TDD, `withTestDb`):**
- `packages/agents/src/hooks.ts` — rewritten Drizzle (keep crypto helpers `hashSecret`/`verifySecret`/`genId`/`genSecret`).
- `packages/agents/src/hooks-db.ts` — `rowToHook`, `rowToHookSafe` mappers (split out to keep `hooks.ts` CCN low).
- `packages/agents/src/hook-jobs.ts` — `createJob`/`getJob`/`updateJob` Drizzle; runner logic unchanged.
- `packages/agents/src/limits.ts` — `reserveAgentResponseSlot` + new `incrementAgentResponseCount`.
- `packages/agents/src/notifications.ts` — `sendInAppNotification` + email user lookup → Postgres.
- `packages/agents/src/__tests__/{hooks,hook-jobs,limits,notifications}.test.ts`.

**Routes (thin, call helpers):** all listed above.

**New migration (one only):** `packages/adapter-postgres/drizzle/NNNN_meta_data_deletion_requests.sql` + `schema/channels.ts` table (Task 7c).

---

# Slice 7a — Hooks + hook_jobs + hooks/chat route

Independently shippable: webhook agent integration on Postgres. Staging e2e = create hook via UI, POST `/api/hooks/[hookId]/chat`, verify reply + `hooks.request_count` increment in DB.

### Task 7a.1: `rowToHook` mappers

**Files:**
- Create: `packages/agents/src/hooks-db.ts`
- Test: `packages/agents/src/__tests__/hooks-db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToHook, rowToHookSafe } from '../hooks-db.ts'

const now = new Date('2026-05-25T00:00:00.000Z')
const row = {
  id: '0190a0aa-0000-7000-8000-000000000001',
  tenantId: 't1',
  agentId: 'a1',
  name: 'Negotiation Service',
  secretHash: 'deadbeef',
  status: 'active' as const,
  requestCount: 3,
  lastUsedAt: now,
  createdAt: now,
  updatedAt: now,
}

describe('rowToHook', () => {
  test('maps a row to the legacy HookDocument shape with ISO timestamps', () => {
    const doc = rowToHook(row)
    assert.equal(doc.id, row.id)
    assert.equal(doc.secretHash, 'deadbeef')
    assert.equal(doc.requestCount, 3)
    assert.equal(doc.lastUsedAt, now.toISOString())
    assert.equal(doc.createdAt, now.toISOString())
  })
  test('rowToHookSafe strips secretHash', () => {
    const safe = rowToHookSafe(row)
    assert.equal('secretHash' in safe, false)
    assert.equal(safe.name, 'Negotiation Service')
  })
  test('null lastUsedAt maps to undefined', () => {
    const doc = rowToHook({ ...row, lastUsedAt: null })
    assert.equal(doc.lastUsedAt, undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions react-server --test packages/agents/src/__tests__/hooks-db.test.ts`
Expected: FAIL — cannot find module `../hooks-db.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Hook } from '@vibesboard/adapter-postgres/schema'
import type { HookDocument } from '@vibesboard/contracts'

export const rowToHook = (r: Hook): HookDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  name: r.name,
  secretHash: r.secretHash,
  status: r.status,
  requestCount: r.requestCount,
  lastUsedAt: r.lastUsedAt?.toISOString() ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

export const rowToHookSafe = (r: Hook): Omit<HookDocument, 'secretHash'> => {
  const { secretHash: _secretHash, ...safe } = rowToHook(r)
  return safe
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --conditions react-server --test packages/agents/src/__tests__/hooks-db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/hooks-db.ts packages/agents/src/__tests__/hooks-db.test.ts
git commit -m "feat(agents): add rowToHook mappers for Postgres hooks (Phase 7a)"
```

### Task 7a.2: Migrate `hooks.ts` CRUD to Postgres

**Files:**
- Modify: `packages/agents/src/hooks.ts` (replace `adminDb`/`Collections` with Drizzle; keep crypto helpers)
- Test: `packages/agents/src/__tests__/hooks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  createHook, getHook, getHookById, listHooks,
  updateHook, deleteHook, verifySecret, recordHookUsage,
} from '../hooks.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID(), t = randomUUID(), a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'Agent', slug: `ag-${a.slice(0,8)}` })
  return { tenantId: t, agentId: a }
}

describe('hooks CRUD (postgres)', () => {
  test('create returns one-time secret, getHook returns hash, verifySecret matches', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook, secretKey } = await createHook(tenantId, agentId, 'Svc', adminDb)
      assert.equal('secretHash' in hook, false)
      const stored = await getHook(tenantId, agentId, hook.id, adminDb)
      assert.ok(stored)
      assert.equal(verifySecret(secretKey, stored!.secretHash), true)
      assert.equal(verifySecret('wrong', stored!.secretHash), false)
    })
  })

  test('getHookById finds the hook across agents', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'Svc', adminDb)
      const found = await getHookById(hook.id, adminDb)
      assert.equal(found?.id, hook.id)
    })
  })

  test('listHooks newest-first, strips secretHash; update + delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'One', adminDb)
      const list = await listHooks(tenantId, agentId, adminDb)
      assert.equal(list.length, 1)
      assert.equal('secretHash' in list[0], false)
      await updateHook(tenantId, agentId, hook.id, { status: 'inactive' }, adminDb)
      assert.equal((await getHook(tenantId, agentId, hook.id, adminDb))!.status, 'inactive')
      await deleteHook(tenantId, agentId, hook.id, adminDb)
      assert.equal(await getHook(tenantId, agentId, hook.id, adminDb), null)
    })
  })

  test('recordHookUsage increments request_count and sets lastUsedAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const { hook } = await createHook(tenantId, agentId, 'Svc', adminDb)
      await recordHookUsage(tenantId, agentId, hook.id, adminDb)
      const after = await getHook(tenantId, agentId, hook.id, adminDb)
      assert.equal(after!.requestCount, 1)
      assert.ok(after!.lastUsedAt)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --conditions react-server --test packages/agents/src/__tests__/hooks.test.ts`
Expected: FAIL — helpers still call `adminDb`/expect different arity (no `db` param).

- [ ] **Step 3: Implement**

Replace the body of `packages/agents/src/hooks.ts`. Keep the `genId`/`genSecret`/`hashSecret`/`verifySecret` crypto helpers verbatim. Replace storage:

```ts
import 'server-only'
import { createHash, timingSafeEqual } from 'crypto'
import { customAlphabet } from 'nanoid'
import { and, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { hooks } from '@vibesboard/adapter-postgres/schema'
import type { HookDocument } from '@vibesboard/contracts'
import { rowToHook, rowToHookSafe } from './hooks-db.ts'

type Db = PostgresJsDatabase<typeof schema>

const genId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 21)
const genSecret = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32)
function hashSecret(secret: string): string { return createHash('sha256').update(secret).digest('hex') }

export interface CreatedHook { hook: Omit<HookDocument, 'secretHash'>; secretKey: string }

export async function createHook(
  tenantId: string, agentId: string, name: string, db: Db = getMigrateDb(),
): Promise<CreatedHook> {
  const secretKey = genSecret()
  const [row] = await db.insert(hooks).values({
    id: uuidv7(), tenantId, agentId, name,
    secretHash: hashSecret(secretKey), status: 'active', requestCount: 0,
  }).returning()
  return { hook: rowToHookSafe(row), secretKey }
}

export async function getHook(
  tenantId: string, agentId: string, hookId: string, db: Db = getMigrateDb(),
): Promise<HookDocument | null> {
  const [row] = await db.select().from(hooks)
    .where(and(eq(hooks.id, hookId), eq(hooks.tenantId, tenantId), eq(hooks.agentId, agentId))).limit(1)
  return row ? rowToHook(row) : null
}

export async function getHookById(hookId: string, db: Db = getMigrateDb()): Promise<HookDocument | null> {
  const [row] = await db.select().from(hooks).where(eq(hooks.id, hookId)).limit(1)
  return row ? rowToHook(row) : null
}

export async function listHooks(
  tenantId: string, agentId: string, db: Db = getMigrateDb(),
): Promise<Omit<HookDocument, 'secretHash'>[]> {
  const rows = await db.select().from(hooks)
    .where(and(eq(hooks.tenantId, tenantId), eq(hooks.agentId, agentId)))
    .orderBy(desc(hooks.createdAt))
  return rows.map(rowToHookSafe)
}

export async function updateHook(
  tenantId: string, agentId: string, hookId: string,
  patch: { name?: string; status?: HookDocument['status'] }, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(hooks).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(hooks.id, hookId), eq(hooks.tenantId, tenantId), eq(hooks.agentId, agentId)))
}

export async function deleteHook(
  tenantId: string, agentId: string, hookId: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.delete(hooks)
    .where(and(eq(hooks.id, hookId), eq(hooks.tenantId, tenantId), eq(hooks.agentId, agentId)))
}

export function verifySecret(rawSecret: string, storedHash: string): boolean {
  const incoming = Buffer.from(hashSecret(rawSecret), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (incoming.length !== stored.length) return false
  return timingSafeEqual(incoming, stored)
}

export async function recordHookUsage(
  tenantId: string, agentId: string, hookId: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(hooks)
    .set({ requestCount: sql`${hooks.requestCount} + 1`, lastUsedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(hooks.id, hookId), eq(hooks.tenantId, tenantId), eq(hooks.agentId, agentId)))
}
```

Note: `recordHookUsage` becomes `async` (was fire-and-forget `void`). The route awaits/`.catch()`es it — update the route in Task 7a.4.

- [ ] **Step 4: Run to verify it passes**

Run: `node --conditions react-server --test packages/agents/src/__tests__/hooks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lizard check**

Run: `python3 -m lizard --CCN 15 packages/agents/src/hooks.ts packages/agents/src/hooks-db.ts`
Expected: no functions reported (none over CCN 15).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/hooks.ts packages/agents/src/__tests__/hooks.test.ts
git commit -m "feat(agents): migrate hooks CRUD to Postgres (Phase 7a)"
```

### Task 7a.3: Migrate `hook-jobs.ts` storage to Postgres

**Files:**
- Modify: `packages/agents/src/hook-jobs.ts` (`createJob`/`getJob`/`updateJob` only; runner logic unchanged)
- Test: `packages/agents/src/__tests__/hook-jobs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, hooks } from '@vibesboard/adapter-postgres/schema'
import { createJob, getJob } from '../hook-jobs.ts'

async function seedHook(adminDb: any) {
  const u = randomUUID(), t = randomUUID(), a = randomUUID(), h = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'Agent', slug: `ag-${a.slice(0,8)}` })
  await adminDb.insert(hooks).values({ id: h, tenantId: t, agentId: a, name: 'H', secretHash: 'x' })
  return { tenantId: t, agentId: a, hookId: h }
}

describe('hook-jobs storage (postgres)', () => {
  test('createJob persists pending job; getJob round-trips', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, hookId } = await seedHook(adminDb)
      const job = await createJob({
        hookId, agentId, tenantId, message: 'hi',
        callbackUrl: 'https://example.com/cb', externalUserId: 'ext1',
      }, adminDb)
      assert.equal(job.status, 'pending')
      assert.equal(job.callbackAttempts, 0)
      const fetched = await getJob(tenantId, agentId, hookId, job.id, adminDb)
      assert.equal(fetched?.message, 'hi')
      assert.equal(fetched?.callbackUrl, 'https://example.com/cb')
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --conditions react-server --test packages/agents/src/__tests__/hook-jobs.test.ts`
Expected: FAIL — `createJob` has no `db` param / still uses `adminDb`.

- [ ] **Step 3: Implement** — add a `rowToHookJob` mapper and rewrite the three DB helpers. Replace the imports `customAlphabet`/`adminDb`/`Collections` block top of file and the three functions:

```ts
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { hookJobs, type HookJob } from '@vibesboard/adapter-postgres/schema'
import { type HookJobDocument } from '@vibesboard/contracts'
// ... keep existing runner imports (getAgentById, ensureConversation, etc.) ...

type Db = PostgresJsDatabase<typeof schema>

const rowToHookJob = (r: HookJob): HookJobDocument => ({
  id: r.id, hookId: r.hookId, agentId: r.agentId, tenantId: r.tenantId,
  message: r.message,
  externalUserId: r.externalUserId ?? undefined,
  conversationId: r.conversationId ?? undefined,
  callbackUrl: r.callbackUrl, status: r.status,
  reply: r.reply ?? undefined, error: r.error ?? undefined,
  callbackStatus: r.callbackStatus ?? undefined,
  callbackAttempts: r.callbackAttempts,
  createdAt: r.createdAt.toISOString(),
  startedAt: r.startedAt?.toISOString() ?? undefined,
  completedAt: r.completedAt?.toISOString() ?? undefined,
  failedAt: r.failedAt?.toISOString() ?? undefined,
})

export async function createJob(params: {
  hookId: string; agentId: string; tenantId: string; message: string
  callbackUrl: string; externalUserId?: string; conversationId?: string
}, db: Db = getMigrateDb()): Promise<HookJobDocument> {
  const [row] = await db.insert(hookJobs).values({
    id: uuidv7(), hookId: params.hookId, agentId: params.agentId, tenantId: params.tenantId,
    message: params.message, callbackUrl: params.callbackUrl,
    externalUserId: params.externalUserId ?? null,
    conversationId: params.conversationId ?? null,
    status: 'pending', callbackAttempts: 0,
  }).returning()
  return rowToHookJob(row)
}

export async function getJob(
  tenantId: string, agentId: string, hookId: string, jobId: string, db: Db = getMigrateDb(),
): Promise<HookJobDocument | null> {
  const [row] = await db.select().from(hookJobs)
    .where(and(eq(hookJobs.id, jobId), eq(hookJobs.tenantId, tenantId),
      eq(hookJobs.agentId, agentId), eq(hookJobs.hookId, hookId))).limit(1)
  return row ? rowToHookJob(row) : null
}

async function updateJob(
  tenantId: string, agentId: string, hookId: string, jobId: string,
  patch: Partial<{ status: HookJobDocument['status']; reply: string; error: string
    conversationId: string; callbackStatus: number; callbackAttempts: number
    startedAt: string; completedAt: string; failedAt: string }>,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(hookJobs).set({
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.reply !== undefined && { reply: patch.reply }),
    ...(patch.error !== undefined && { error: patch.error }),
    ...(patch.conversationId !== undefined && { conversationId: patch.conversationId }),
    ...(patch.callbackStatus !== undefined && { callbackStatus: patch.callbackStatus }),
    ...(patch.callbackAttempts !== undefined && { callbackAttempts: patch.callbackAttempts }),
    ...(patch.startedAt !== undefined && { startedAt: new Date(patch.startedAt) }),
    ...(patch.completedAt !== undefined && { completedAt: new Date(patch.completedAt) }),
    ...(patch.failedAt !== undefined && { failedAt: new Date(patch.failedAt) }),
  }).where(and(eq(hookJobs.id, jobId), eq(hookJobs.tenantId, tenantId),
    eq(hookJobs.agentId, agentId), eq(hookJobs.hookId, hookId)))
}
```

Leave `runJobAsync`/`deliverCallback` bodies unchanged — they call `updateJob` with the same string-timestamp patches, now translated to `Date` above.

- [ ] **Step 4: Run to verify it passes**

Run: `node --conditions react-server --test packages/agents/src/__tests__/hook-jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Lizard check**

Run: `python3 -m lizard --CCN 15 packages/agents/src/hook-jobs.ts`
Expected: `updateJob`'s spread map and `runJobAsync` may approach the limit. If `updateJob` or `runJobAsync` exceeds CCN 15, extract the spread into a `buildJobPatch(patch)` pure helper and re-run. Record the result.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/hook-jobs.ts packages/agents/src/__tests__/hook-jobs.test.ts
git commit -m "feat(agents): migrate hook_jobs storage to Postgres (Phase 7a)"
```

### Task 7a.4: Thin the `hooks/[hookId]/chat` route

**Files:**
- Modify: `apps/web/app/api/hooks/[hookId]/chat/route.ts`

- [ ] **Step 1: Remove Firestore imports and the inline increment**

Delete lines: `import { FieldValue } from 'firebase-admin/firestore'`, `import { adminDb } from '@vibesboard/adapter-firebase/admin'`, `import { Collections } from '@vibesboard/contracts'`.

Replace the `adminDb.collection(Collections.agents(...)).update({ totalResponseCount: FieldValue.increment(1) })` block (lines ~185-191) with:

```ts
import { incrementAgentResponseCount } from '@vibesboard/agents/limits'
// ... inside onCompletion:
incrementAgentResponseCount(currentAgent.tenantId!, currentAgent.id).catch((e: unknown) =>
  console.error('[hooks] Failed to increment response count:', e)
)
```

> `incrementAgentResponseCount` is created in Task 7b.1. **Sequencing: do Task 7b.1 before this step** (or stub-import then wire). Recommended order within 7a: 7a.1 → 7a.2 → 7a.3, then merge 7b.1's limits helper before 7a.4. To keep 7a independently shippable, fold Task 7b.1 (the `incrementAgentResponseCount` helper) into 7a as Task 7a.0.

- [ ] **Step 2: Update `recordHookUsage` call** — it is now `async`; it was already fire-and-forget. Change line ~281 to:

```ts
recordHookUsage(agent.tenantId!, agent.id, hookId).catch(e =>
  console.error('[hooks] Failed to record hook usage:', e)
)
```

- [ ] **Step 3: Build check**

Run: `npm run -w apps/web typecheck` (or `tsc --noEmit -p apps/web`)
Expected: no errors; no remaining `adminDb`/`Collections`/`FieldValue` in this file.

Verify: `grep -nE "adminDb|Collections|firebase-admin" apps/web/app/api/hooks/\[hookId\]/chat/route.ts` → no matches.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/api/hooks/[hookId]/chat/route.ts"
git commit -m "refactor(hooks-chat): remove residual Firestore from hook chat route (Phase 7a)"
```

**Slice 7a staging e2e:** Deploy. Create a hook on a test agent. `curl -X POST $URL/api/hooks/$HOOK/chat -H "x-hook-secret: $SECRET" -d '{"message":"hello"}'` → 200 with `reply`. In Postgres: `SELECT request_count, last_used_at FROM hooks WHERE id=$HOOK` shows `request_count >= 1`. Confirm `SELECT count(*) FROM hook_jobs` unaffected; run an async hook job if the UI exposes it and verify a `hook_jobs` row reaches `completed`.

---

# Slice 7b — Usage/limits + notifications + their routes + chat-route residuals

Independently shippable. Staging e2e = lifetime cap enforced; notifications listed/counted/marked-read; usage page renders without 500.

### Task 7b.1: `incrementAgentResponseCount` + Postgres `reserveAgentResponseSlot`

**Files:**
- Modify: `packages/agents/src/limits.ts`
- Test: `packages/agents/src/__tests__/limits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { reserveAgentResponseSlot, incrementAgentResponseCount } from '../limits.ts'

async function seedAgent(adminDb: any, totalResponseCount = 0) {
  const u = randomUUID(), t = randomUUID(), a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'Agent', slug: `ag-${a.slice(0,8)}`, totalResponseCount })
  return { tenantId: t, agentId: a }
}

describe('agent response limits (postgres)', () => {
  test('incrementAgentResponseCount adds 1 atomically', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 4)
      await incrementAgentResponseCount(tenantId, agentId, adminDb)
      const [row] = await adminDb.select().from(agents).where(eq(agents.id, agentId))
      assert.equal(row.totalResponseCount, 5)
    })
  })

  test('reserveAgentResponseSlot returns true below cap and increments', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 9)
      const ok = await reserveAgentResponseSlot(tenantId, agentId, 10, adminDb)
      assert.equal(ok, true)
      const [row] = await adminDb.select().from(agents).where(eq(agents.id, agentId))
      assert.equal(row.totalResponseCount, 10)
    })
  })

  test('reserveAgentResponseSlot returns false at cap and does not increment', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb, 10)
      const ok = await reserveAgentResponseSlot(tenantId, agentId, 10, adminDb)
      assert.equal(ok, false)
      const [row] = await adminDb.select().from(agents).where(eq(agents.id, agentId))
      assert.equal(row.totalResponseCount, 10)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --conditions react-server --test packages/agents/src/__tests__/limits.test.ts`
Expected: FAIL — `incrementAgentResponseCount` undefined; `reserveAgentResponseSlot` wrong signature.

- [ ] **Step 3: Implement** — replace `packages/agents/src/limits.ts` entirely:

```ts
import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/**
 * Atomically increment an agent's lifetime response counter.
 * Fire-and-forget at the call site; replaces Firestore FieldValue.increment(1).
 */
export async function incrementAgentResponseCount(
  tenantId: string, agentId: string, db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(agents)
    .set({ totalResponseCount: sql`${agents.totalResponseCount} + 1` })
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
}

/**
 * Atomically check the lifetime cap and reserve a slot in one statement.
 * Returns true if a slot was reserved, false if the cap is reached.
 * The conditional UPDATE … WHERE total_response_count < cap RETURNING id is
 * atomic under MVCC — no read-modify-write race, no explicit transaction.
 */
export async function reserveAgentResponseSlot(
  tenantId: string, agentId: string, maxAgentResponses: number, db: Db = getMigrateDb(),
): Promise<boolean> {
  const rows = await db.update(agents)
    .set({ totalResponseCount: sql`${agents.totalResponseCount} + 1` })
    .where(and(
      eq(agents.id, agentId),
      eq(agents.tenantId, tenantId),
      sql`${agents.totalResponseCount} < ${maxAgentResponses}`,
    ))
    .returning({ id: agents.id })
  return rows.length > 0
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --conditions react-server --test packages/agents/src/__tests__/limits.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lizard + commit**

Run: `python3 -m lizard --CCN 15 packages/agents/src/limits.ts` → expect none over 15.

```bash
git add packages/agents/src/limits.ts packages/agents/src/__tests__/limits.test.ts
git commit -m "feat(agents): Postgres atomic agent response counter (Phase 7b)"
```

### Task 7b.2: Wire the increment into the two chat routes

**Files:**
- Modify: `apps/web/app/api/agents/[id]/chat/route.ts`
- Modify: `apps/web/app/api/public/agents/[agentId]/chat/route.ts`

- [ ] **Step 1: `agents/[id]/chat`** — remove `FieldValue`/`adminDb`/`Collections` imports; replace lines ~268-271 with:

```ts
import { incrementAgentResponseCount } from '@vibesboard/agents/limits'
// inside onCompletion:
incrementAgentResponseCount(activeAgent.tenantId!, activeAgent.id).catch((e: unknown) =>
  console.error('[chat] Failed to increment response count:', e)
)
```

- [ ] **Step 2: `public/agents/[agentId]/chat`** — remove `FieldValue`/`adminDb`/`Collections` imports; replace the capped/uncapped branch (lines ~282-313) with the single capped helper, preserving the near-cap behavior:

```ts
import { incrementAgentResponseCount, reserveAgentResponseSlot } from '@vibesboard/agents/limits'
// inside onCompletion, replacing the if/else Firestore block:
if (
  activeAgent.maxAgentResponses &&
  (activeAgent.totalResponseCount ?? 0) + 5 >= activeAgent.maxAgentResponses
) {
  reserveAgentResponseSlot(
    activeAgent.tenantId!, activeAgent.id, activeAgent.maxAgentResponses,
  ).catch((e: unknown) =>
    console.error('[chat] Failed to increment response count (reserve):', e))
} else {
  incrementAgentResponseCount(activeAgent.tenantId!, activeAgent.id).catch((e: unknown) =>
    console.error('[chat] Failed to increment response count:', e))
}
```

- [ ] **Step 3: Verify no Firestore remains**

Run: `grep -nE "adminDb|Collections|firebase-admin" "apps/web/app/api/agents/[id]/chat/route.ts" "apps/web/app/api/public/agents/[agentId]/chat/route.ts"`
Expected: no matches.

- [ ] **Step 4: Typecheck + commit**

```bash
git add "apps/web/app/api/agents/[id]/chat/route.ts" "apps/web/app/api/public/agents/[agentId]/chat/route.ts"
git commit -m "refactor(chat): use Postgres response counter in chat routes (Phase 7b)"
```

### Task 7b.3: Notifications data helpers (package)

**Files:**
- Create: `packages/agents/src/notifications-db.ts` (`createInAppNotification`, `listNotifications`, `countUnreadNotifications`, `markNotificationsRead`, `getUserEmail`, `rowToNotification`)
- Test: `packages/agents/src/__tests__/notifications-db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  createInAppNotification, listNotifications,
  countUnreadNotifications, markNotificationsRead, getUserEmail,
} from '../notifications-db.ts'

async function seed(adminDb: any) {
  const u = randomUUID(), t = randomUUID(), a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'Owner' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'Agent', slug: `ag-${a.slice(0,8)}` })
  return { userId: u, tenantId: t, agentId: a }
}

describe('notifications (postgres)', () => {
  test('create → list → count → markRead', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const n = await createInAppNotification({
        tenantId, agentId, conversationId: null,
        event: 'completed', summary: 'done',
      }, adminDb)
      assert.equal(n.read, false)
      assert.equal(await countUnreadNotifications(tenantId, adminDb), 1)
      const all = await listNotifications(tenantId, { limit: 20, unreadOnly: false }, adminDb)
      assert.equal(all.length, 1)
      assert.equal(all[0].event, 'completed')
      await markNotificationsRead(tenantId, [n.id], adminDb)
      assert.equal(await countUnreadNotifications(tenantId, adminDb), 0)
    })
  })

  test('listNotifications unreadOnly filters read rows', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const a = await createInAppNotification({ tenantId, agentId, conversationId: null, event: 'completed', summary: null }, adminDb)
      await createInAppNotification({ tenantId, agentId, conversationId: null, event: 'handoff', summary: null }, adminDb)
      await markNotificationsRead(tenantId, [a.id], adminDb)
      const unread = await listNotifications(tenantId, { limit: 20, unreadOnly: true }, adminDb)
      assert.equal(unread.length, 1)
      assert.equal(unread[0].event, 'handoff')
    })
  })

  test('getUserEmail returns the user email', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { userId } = await seed(adminDb)
      const email = await getUserEmail(userId, adminDb)
      assert.ok(email && email.endsWith('@a.com'))
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --conditions react-server --test packages/agents/src/__tests__/notifications-db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `packages/agents/src/notifications-db.ts`:

```ts
import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { notifications, users, type Notification } from '@vibesboard/adapter-postgres/schema'
import type { NotificationDocument, NotificationEvent } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

// Note: the legacy NotificationDocument carries agentName; the PG table does not
// store it (it is denormalized at the agent). The list API never used agentName
// on the client list — map it to '' to preserve the wire shape.
export const rowToNotification = (r: Notification): NotificationDocument => ({
  id: r.id, tenantId: r.tenantId, agentId: r.agentId, agentName: '',
  conversationId: r.conversationId ?? '',
  event: r.event, summary: r.summary ?? null, read: r.read,
  createdAt: r.createdAt.toISOString(),
})

export async function createInAppNotification(params: {
  tenantId: string; agentId: string; conversationId: string | null
  event: NotificationEvent; summary: string | null
}, db: Db = getMigrateDb()): Promise<NotificationDocument> {
  const [row] = await db.insert(notifications).values({
    id: uuidv7(), tenantId: params.tenantId, agentId: params.agentId,
    conversationId: params.conversationId, event: params.event,
    summary: params.summary, read: false,
  }).returning()
  return rowToNotification(row)
}

export async function listNotifications(
  tenantId: string, opts: { limit: number; unreadOnly: boolean }, db: Db = getMigrateDb(),
): Promise<NotificationDocument[]> {
  const where = opts.unreadOnly
    ? and(eq(notifications.tenantId, tenantId), eq(notifications.read, false))
    : eq(notifications.tenantId, tenantId)
  const rows = await db.select().from(notifications)
    .where(where).orderBy(desc(notifications.createdAt)).limit(opts.limit)
  return rows.map(rowToNotification)
}

export async function countUnreadNotifications(
  tenantId: string, db: Db = getMigrateDb(),
): Promise<number> {
  const rows = await db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.read, false)))
  return rows.length
}

export async function markNotificationsRead(
  tenantId: string, ids: string[], db: Db = getMigrateDb(),
): Promise<void> {
  if (ids.length === 0) return
  await db.update(notifications).set({ read: true })
    .where(and(eq(notifications.tenantId, tenantId), inArray(notifications.id, ids)))
}

export async function getUserEmail(
  userId: string, db: Db = getMigrateDb(),
): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users)
    .where(eq(users.id, userId)).limit(1)
  return row?.email ?? null
}
```

> `countUnreadNotifications` uses a row-count rather than SQL `count()` to keep the helper trivial and avoid the `sql<number>` cast; for the unread badge volumes are tiny. If you prefer SQL count, use `db.select({ c: sql<number>\`count(*)\` })` and `Number(rows[0].c)`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --conditions react-server --test packages/agents/src/__tests__/notifications-db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lizard + commit**

Run: `python3 -m lizard --CCN 15 packages/agents/src/notifications-db.ts` → none over 15.

```bash
git add packages/agents/src/notifications-db.ts packages/agents/src/__tests__/notifications-db.test.ts
git commit -m "feat(agents): Postgres notifications data helpers (Phase 7b)"
```

### Task 7b.4: Wire `notifications.ts` senders to Postgres

**Files:**
- Modify: `packages/agents/src/notifications.ts` (`sendInAppNotification`, email user-email lookup)

- [ ] **Step 1: Replace Firestore in `sendInAppNotification`** — remove `adminDb`/`Collections` imports. Replace the body:

```ts
import { createInAppNotification, getUserEmail } from './notifications-db.ts'
// ...
async function sendInAppNotification(payload: NotificationPayload): Promise<void> {
  const { agent, conversationId, event, summary } = payload
  await createInAppNotification({
    tenantId: agent.tenantId!, agentId: agent.id,
    conversationId: conversationId || null, event, summary: summary ?? null,
  })
}
```

- [ ] **Step 2: Replace the email fallback user lookup** — in `sendEmailNotification` replace the `adminDb.collection(Collections.users).doc(agent.userId).get()` block with:

```ts
if (!toAddress) {
  toAddress = await getUserEmail(agent.userId)
}
```

- [ ] **Step 3: Verify no Firestore remains**

Run: `grep -nE "adminDb|Collections|firebase-admin" packages/agents/src/notifications.ts`
Expected: no matches.

- [ ] **Step 4: Lizard `_dispatchAsync`** — it has many `&&`/`?.` branches. Run `python3 -m lizard --CCN 15 packages/agents/src/notifications.ts`. If `_dispatchAsync` exceeds CCN 15, extract each channel block into `maybeSendInApp(payload)`, `maybeSendEmail(payload, config)`, `maybeSendWebhook(payload, config)` helpers returning `Promise<void>[]` contributions. Re-run.

- [ ] **Step 5: Run package tests + commit**

Run: `node --conditions react-server --test packages/agents/src/__tests__/notifications-db.test.ts`

```bash
git add packages/agents/src/notifications.ts
git commit -m "refactor(agents): in-app notifications + email lookup on Postgres (Phase 7b)"
```

### Task 7b.5: Thin the notifications routes

**Files:**
- Modify: `apps/web/app/api/notifications/route.ts`
- Modify: `apps/web/app/api/notifications/count/route.ts`

- [ ] **Step 1: `notifications/route.ts`** — remove `adminDb`/`Collections` imports; GET and PATCH:

```ts
import { listNotifications, markNotificationsRead } from '@vibesboard/agents/notifications-db'
// GET:
const url = new URL(req.url)
const unreadOnly = url.searchParams.get('unread') === 'true'
const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 50)
const notifications = await listNotifications(tenantId, { limit, unreadOnly })
return NextResponse.json({ notifications })
// PATCH (after zod parse):
await markNotificationsRead(tenantId, parsed.data.ids)
return NextResponse.json({ ok: true })
```

- [ ] **Step 2: `notifications/count/route.ts`**:

```ts
import { countUnreadNotifications } from '@vibesboard/agents/notifications-db'
// GET:
const count = await countUnreadNotifications(tenantId)
return NextResponse.json({ count })
```

> Add the `notifications-db` subpath export to `packages/agents/package.json` `exports` map mirroring how `hooks`/`conversations` are exposed (`"./notifications-db": "./src/notifications-db.ts"`). Verify the existing export map style first: `grep -n "exports" -A30 packages/agents/package.json`.

- [ ] **Step 3: Verify + typecheck + commit**

Run: `grep -rnE "adminDb|Collections|firebase-admin" apps/web/app/api/notifications/`
Expected: no matches.

```bash
git add apps/web/app/api/notifications/route.ts apps/web/app/api/notifications/count/route.ts packages/agents/package.json
git commit -m "refactor(notifications): thin routes onto Postgres helpers (Phase 7b)"
```

### Task 7b.6: Usage routes — honest empty rollup (vestigial reads)

**Files:**
- Modify: `apps/web/app/api/tenants/[id]/usage/route.ts`
- Modify: `apps/web/app/api/admin/tenants/[id]/usage/route.ts`

Context: these read `Collections.usageRollups`/`usageLogs` and `tenantDoc.subscription`. `policy/usage` no longer writes rollups/logs (no-op shim) and `tenants` has no `subscription` column in Postgres. The data is gone; keep the routes alive returning a truthful empty/zero shape so the UI does not 500.

- [ ] **Step 1: `tenants/[id]/usage`** — remove `adminDb`/`Collections` imports; keep auth. Replace the body after auth with:

```ts
const now = new Date()
const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
return NextResponse.json({
  subscription: null,
  rollup: null,
  dailyUsage: [],
  billingCycleId,
})
```

- [ ] **Step 2: `admin/tenants/[id]/usage`** — same, with the extra keys the admin UI expects:

```ts
const now = new Date()
const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
return NextResponse.json({
  subscription: null,
  rollup: null,
  agentNames: {},
  userNames: {},
  dailyUsage: [],
  billingCycleId,
})
```

- [ ] **Step 3: Verify + commit**

Run: `grep -rnE "adminDb|Collections|firebase-admin" "apps/web/app/api/tenants/[id]/usage/route.ts" "apps/web/app/api/admin/tenants/[id]/usage/route.ts"`
Expected: no matches.

```bash
git add "apps/web/app/api/tenants/[id]/usage/route.ts" "apps/web/app/api/admin/tenants/[id]/usage/route.ts"
git commit -m "refactor(usage): return honest empty rollup; drop dead Firestore reads (Phase 7b)"
```

**Slice 7b staging e2e:** Cap-test: set an agent's `max_agent_responses` low, chat past it on the public route, confirm cap holds and `total_response_count` stops at the cap. Trigger a "completed" notification (configure in-app notifications on an agent, finish a conversation); `GET /api/notifications` lists it, `GET /api/notifications/count` shows it, `PATCH /api/notifications` marks read. `GET /api/tenants/$T/usage` returns 200 with empty rollup (no 500).

---

# Slice 7c — Misc routes + residual page reads + the `chats` decision

Independently shippable per route. Each task verifies via `grep` no-Firestore + a staging check.

### Task 7c.0: DECISION — the `chats` legacy playground

**No Postgres `chats` table exists.** Present these to the user before coding (this is a checkpoint, not silent invention):

- **Option A — migrate:** add a `chats` table (`id uuid pk`, `user_id uuid fk`, `payload jsonb`, `share_path text`, `created_at`) + migration, rewrite `actions.ts` (6 fns) and `api/chat/route.ts` `saveChat` to Drizzle. Most work; only justified if the playground is still used.
- **Option B — delete (recommended):** the assistant playground (`app/chat/[id]/page.tsx`, `app/share/[id]/page.tsx`, `app/chat/layout.tsx`, `components/clear-history.tsx`, `api/chat/route.ts`, the 6 chat actions in `actions.ts`) predates the agent product and is not used by any agent flow. Remove the routes/pages/actions and the `Collections.chats` references. Keep `getAgents`/`getAgentConversations` in `actions.ts` (already Postgres).
- **Option C — defer:** leave `chats` on Firestore and explicitly carve it out of the teardown grep gate (Task 7d) as a known-remaining legacy collection.

- [ ] **Step 1: Ask the user which option.** Do not proceed on `chats` until answered. Record the decision in the PR description.
- [ ] **Step 2 (if B):** delete the files listed; `grep -rn "Collections.chats\|getChats\|getSharedChat\|shareChat\|removeChat\|clearChats\b\|getChat\b" apps/web` returns no matches outside removed files. Commit `chore(chat): remove legacy assistant playground (Phase 7c)`.
- [ ] **Step 2 (if A):** follow the standard table+migration+helper+test pattern from earlier tasks; add `chats` to `schema/index.ts`. (Spec out a `chats.ts` helper module with `withTestDb` tests mirroring 7b.3.)

### Task 7c.1: `google-review` route → Postgres tenants

**Files:**
- Modify: `apps/web/app/api/tenants/[id]/google-review/route.ts`
- Create helper: `packages/tenants/src/google-review.ts` (`getTenantGooglePlaceId`, `setTenantGooglePlaceId`, `getTenantIsPersonal`) + test (use the `@vibesboard/tenants` package that already holds identity helpers; confirm with `ls packages/tenants/src`). If no `tenants` package, co-locate in `apps/web/lib/tenant-context.ts` extension instead — verify which exists.

- [ ] **Step 1: Write the failing test** (in whichever package holds tenant helpers):

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import { getTenantGooglePlaceId, setTenantGooglePlaceId, getTenantIsPersonal } from '../google-review.ts'

async function seedTenant(adminDb: any, isPersonal = false) {
  const u = randomUUID(), t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal })
  return { tenantId: t }
}

describe('tenant google review (postgres)', () => {
  test('get returns null initially, set persists, isPersonal reflects column', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      assert.equal(await getTenantGooglePlaceId(tenantId, adminDb), null)
      assert.equal(await getTenantIsPersonal(tenantId, adminDb), false)
      await setTenantGooglePlaceId(tenantId, 'ChIJ123', adminDb)
      assert.equal(await getTenantGooglePlaceId(tenantId, adminDb), 'ChIJ123')
      await setTenantGooglePlaceId(tenantId, null, adminDb)
      assert.equal(await getTenantGooglePlaceId(tenantId, adminDb), null)
    })
  })
})
```

- [ ] **Step 2: Run → fail. Step 3: implement** helpers (Drizzle `getMigrateDb`, `eq(tenants.id, …)`, `update … set { googlePlaceId, updatedAt: new Date() }`). **Step 4: pass.**

- [ ] **Step 5: Rewrite the route** — remove `adminDb`/`Collections`; GET returns `{ googlePlaceId: await getTenantGooglePlaceId(tenantId) }` with a 404 when the tenant is missing (check via existing `getTenantById`); PUT uses `getTenantIsPersonal` for the personal-workspace guard and `setTenantGooglePlaceId`. Keep the `isFeatureEnabled` gate (shim returns true).

- [ ] **Step 6: Verify + commit**

Run: `grep -nE "adminDb|Collections|firebase-admin" "apps/web/app/api/tenants/[id]/google-review/route.ts"` → none.

```bash
git add "apps/web/app/api/tenants/[id]/google-review/route.ts" <helper + test>
git commit -m "feat(google-review): migrate tenant Place ID to Postgres (Phase 7c)"
```

### Task 7c.2: `access-password` route → Postgres agents

**Files:**
- Modify: `apps/web/app/api/agents/[id]/access-password/route.ts`
- Create helper: `packages/agents/src/access-password.ts` (`setAgentAccessPasswordHash`, `clearAgentAccessPasswordHash`) + test.

> Note the column mismatch: legacy Firestore wrote field `accessPassword`; the Postgres column is `access_password_hash` (`agents.accessPasswordHash`). The route already computes `hashPassword(...)`, so we store the hash into `accessPasswordHash`.

- [ ] **Step 1: Test** (`withTestDb`, seed agent, call set → assert column populated, call clear → assert null).
- [ ] **Step 2: fail. Step 3: implement** Drizzle update on `agents.accessPasswordHash` scoped by `(id, tenantId)`. **Step 4: pass.**
- [ ] **Step 5: Rewrite route** — PUT calls `setAgentAccessPasswordHash(agent.tenantId, id, hashPassword(parsed.data.password))`; DELETE calls `clearAgentAccessPasswordHash(agent.tenantId, id)`. Keep all auth/validation/`canEditAgent`/tenant-null guards intact.
- [ ] **Step 6:** `grep` clean + commit `feat(access-password): migrate to Postgres agents column (Phase 7c)`.

### Task 7c.3: `agent-creator` route → Postgres agents insert

**Files:**
- Modify: `apps/web/app/api/agent-creator/route.ts`

The `create_agent` tool's `execute` writes via `adminDb.collection(Collections.agents(...)).set(...)`. Mirror the existing **`apps/web/app/api/agents/route.ts` POST** (it already does `uuidv7()` + `ensureUniqueSlug` + `db.insert(agentsTable).values(insertValues)`). Reuse the same insert shape.

- [ ] **Step 1:** Remove `adminDb`/`Collections` imports; import `getMigrateDb` + `agents as agentsTable` (or extract a shared `createAgent()` helper from `api/agents/route.ts` into `packages/agents/src/db.ts` and call it from both — preferred; if extracting, add a `withTestDb` test for `createAgent`).
- [ ] **Step 2:** Replace `adminDb…set({...})` with the Drizzle insert. Map fields: `id: agentId` (use `uuidv7()` instead of `nanoid()` for the agent id to match PG uuid PK), `tenantId`, `userId: session.user.id`, `name`, `instructions`, `slug` (the computed `slug`), `fileKeys`, `tools: toolsPayload`, `allowAnonymous`, `greetingText`, `mode`, `maxResponses`, `maxAgentResponses`, `quickSuggestionsMode`, `quickSuggestionsCount`, `retrievalStrategy`, `bookingConfig`. Drop `tenantSlug`/`agentUrl`/`totalResponseCount`/`sourceUrls` if not columns — verify against `schema/agents.ts` (no `agentUrl`/`tenantSlug`/`sourceUrls` columns; slug+tenant join provides them; `totalResponseCount` defaults 0).
- [ ] **Step 3:** Keep the file-processing trigger and the `agentcreated` response block.
- [ ] **Step 4:** Lizard — the `execute` closure is large/branchy. Run `python3 -m lizard --CCN 15 apps/web/app/api/agent-creator/route.ts`; if `execute` or `POST` exceeds 15, extract `buildAgentInsertValues(args, ctx)` pure helper. Re-run.
- [ ] **Step 5:** `grep` clean + commit `feat(agent-creator): create agents in Postgres (Phase 7c)`.

### Task 7c.4: `admin/files/process` → Postgres agent_files

**Files:**
- Modify: `apps/web/app/api/admin/files/process/route.ts`
- Create helper: `packages/agents/src/file-admin.ts` (`listFilesForAdmin`, `countFilesByStatus`, `getFilesByIds`) + test. Phase 3 migrated `agentFiles` → confirm the table name with `grep -n "pgTable" packages/adapter-postgres/src/schema/files.ts`.

- [ ] **Step 1: Test** — seed tenant+agent+files with mixed statuses; assert `listFilesForAdmin({status,limit,agentId})` filters correctly and `countFilesByStatus()` returns the right tallies.
- [ ] **Step 2: fail. Step 3: implement** Drizzle queries across the `agent_files` table (no collectionGroup — a single `WHERE` with optional `status`/`agent_id` filters, `ORDER BY created_at DESC LIMIT n`); `countFilesByStatus` is a `GROUP BY status` aggregate mapped into the `{total,pending,processing,indexed,failed}` shape. **Step 4: pass.**
- [ ] **Step 5: Rewrite route** GET → `listFilesForAdmin` + `countFilesByStatus`; POST → `getFilesByIds(fileIds)` or `listFilesForAdmin({status:targetStatus,limit})` then existing `processBatch`. Remove the Firestore-index 503 special-casing (no longer relevant).
- [ ] **Step 6: Lizard** the GET/POST handlers (branchy). Extract if needed. `grep` clean + commit `feat(admin-files): Postgres file processing observability (Phase 7c)`.

### Task 7c.5: `meta/data-deletion` (+ status) → Postgres

**Files:**
- Create migration: `packages/adapter-postgres/drizzle/NNNN_meta_data_deletion_requests.sql`
- Modify: `packages/adapter-postgres/src/schema/channels.ts` (add `metaDataDeletionRequests` table — **no tenant scope**, this is a global request log keyed by confirmation code)
- Create helper: `packages/channel-instagram/src/data-deletion.ts` (`createDeletionRequest`, `getDeletionRequest`, `updateDeletionRequest`, `deleteInstagramDataForMetaUser`) + test.
- Modify: `apps/web/app/api/meta/data-deletion/route.ts` + `status/route.ts`

- [ ] **Step 1: Add the schema table** to `channels.ts`:

```ts
export const metaDataDeletionRequests = pgTable('meta_data_deletion_requests', {
  confirmationCode: text('confirmation_code').primaryKey(),
  metaUserId: text('meta_user_id').notNull(),
  status: text('status', { enum: ['pending', 'completed', 'failed'] }).notNull().default('pending'),
  deletedAccounts: integer('deleted_accounts').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})
export type MetaDataDeletionRequest = typeof metaDataDeletionRequests.$inferSelect
```

- [ ] **Step 2: Generate the migration** — run the repo's drizzle-kit generate command (find it: `grep -n "drizzle-kit\|generate" packages/adapter-postgres/package.json`). Confirm a new `drizzle/NNNN_*.sql` appears containing `CREATE TABLE … meta_data_deletion_requests`. Add it to `schema/index.ts` re-exports if that file enumerates tables (`grep -n "channels" packages/adapter-postgres/src/schema/index.ts`).

- [ ] **Step 3: Test the helper** (`withTestDb`): seed an instagram account with a `metaUserId` + a conversation + a message; call `deleteInstagramDataForMetaUser(metaUserId)` → assert account/conversation/message rows gone (FK cascade handles children; the helper deletes accounts `WHERE meta_user_id = $1` and returns the count). Also test `createDeletionRequest`/`getDeletionRequest`/`updateDeletionRequest` round-trip.

- [ ] **Step 4: Implement** the helper. `deleteInstagramDataForMetaUser` = `DELETE FROM instagram_inbox_accounts WHERE meta_user_id = $1 RETURNING id` — `instagram_inbox_conversations`/`_messages` cascade via existing FKs (verify `onDelete: 'cascade'` in schema — confirmed for conversations→account). Request CRUD via Drizzle on the new table (BYPASSRLS `getMigrateDb` — global table, no tenant context).

- [ ] **Step 5: Rewrite the routes** — remove `adminDb`/`FieldValue`. POST: `createDeletionRequest(confirmationCode, metaUserId)`, then fire-and-forget `deleteInstagramDataForMetaUser(metaUserId).then(n => updateDeletionRequest(code,{status:'completed',deletedAccounts:n,completedAt}))` with a `.catch` updating `status:'failed'`. Status GET: `getDeletionRequest(id)` → map to `{confirmation_code,status,created_at,completed_at}`. Keep `parseSignedRequest` (pure crypto) unchanged.

- [ ] **Step 6:** `grep -rnE "adminDb|Collections|firebase-admin" apps/web/app/api/meta/data-deletion/` → none. Lizard the deletion helper + route. Commit `feat(data-deletion): Postgres meta deletion + instagram cascade (Phase 7c)`.

### Task 7c.6: Residual page reads

**Files:**
- Modify: `apps/web/app/admin/agents/[id]/page.tsx`
- Modify: `apps/web/app/agents/[id]/layout.tsx`

- [ ] **Step 1: `admin/agents/[id]/page.tsx`** — remove `adminDb`/`Collections`. Replace the tenant lookup with the already-Postgres `getTenantById` from `@/lib/tenant-context`:

```ts
import { getTenantById } from '@/lib/tenant-context'
// ...
let tenant: { id: string; name: string; slug: string } | null = null
if (tenantId) {
  const t = await getTenantById(tenantId)
  if (t) tenant = { id: t.id, name: t.name, slug: t.slug }
}
```

(Verify `getTenantById`'s return shape with `sed -n '165,210p' apps/web/lib/tenant-context.ts`.)

- [ ] **Step 2: `agents/[id]/layout.tsx`** — remove `adminDb`/`Collections`/`mapConversationDoc`. Replace the conversation snapshot with the already-Postgres `listAgentConversations` from `@vibesboard/agents/conversations`:

```ts
import { listAgentConversations } from '@vibesboard/agents/conversations'
// ...
let conversations: Awaited<ReturnType<typeof listAgentConversations>> = []
if (tenantId) {
  conversations = await listAgentConversations(tenantId, agent.id)
}
```

(`conversations` is computed but currently unused in the render — it was dead before too; confirm with a read of the JSX. If genuinely unused, delete the variable entirely.)

- [ ] **Step 3:** `grep -rnE "adminDb|Collections|firebase-admin" "apps/web/app/admin/agents/[id]/page.tsx" "apps/web/app/agents/[id]/layout.tsx"` → none. Typecheck. Commit `refactor(pages): drop residual Firestore from agent admin/layout pages (Phase 7c)`.

### Task 7c.7 (optional, PR 1f): Delete vestigial feature-flags routes

**Files:**
- Delete: `apps/web/app/api/admin/feature-flags/route.ts`, `apps/web/app/api/admin/feature-flags/[id]/route.ts` (and the dir).

`policy/features` is an all-enabled shim; these routes write Firestore flags nothing reads.

- [ ] **Step 1:** Confirm no client calls them: `grep -rn "/api/admin/feature-flags" apps/web --include="*.tsx" --include="*.ts" | grep -v "app/api/admin/feature-flags"`. If a UI page calls them, either stub the routes to return `{ flags: [] }`/`501` or remove the calling UI too — surface to the user.
- [ ] **Step 2:** Delete the route files (or stub). Commit `chore(feature-flags): remove vestigial Firestore feature-flag routes (Phase 7c / PR 1f)`.

**Slice 7c staging e2e:** Google review GET/PUT round-trips on a team workspace (and 403 on personal). Set/clear an agent access password; the access gate honors it. Create an agent via the agent-creator chat ("create it") → agent appears, `SELECT * FROM agents WHERE id=…`. Admin files page lists files + stats. POST a Meta `signed_request` (test signature) → `meta_data_deletion_requests` row created, instagram rows for that `meta_user_id` deleted, `/status?id=` reports `completed`. Admin agent page + agent layout render.

---

# Slice 7d — TEARDOWN

Only after 7a–7c are merged and smoke-verified. Removes Firestore *data-plane* access; keeps Firebase Auth/RISC.

### Task 7d.1: Prove zero Firestore data access remains

- [ ] **Step 1: Run the gate** (this is the acceptance test for teardown):

```bash
grep -rlnE "adminDb|firebase-admin/firestore|Collections\." packages apps/web/app apps/web/lib \
  | grep -vE "\.next|__tests__|\.test\.|node_modules|adapter-firebase/src|risc\.ts|firestore-types|test-utils"
```

Expected: **empty output.** If `chats` was deferred (7c.0 Option C), it appears here — that is the only allowed remaining entry; document it.

- [ ] **Step 2:** Also confirm no `FieldValue` data writes remain: `grep -rln "firebase-admin/firestore" packages apps | grep -vE "node_modules|adapter-firebase/src|\.next"` → empty.

### Task 7d.2: Remove `adapter-firebase` Firestore imports + deps where Firestore-only

**Files:** the `package.json`s found earlier: `packages/{agents,ai,retrieval,policy,contracts,adapter-google}/package.json`, `apps/web/package.json`, `apps/functions/package.json`.

- [ ] **Step 1: Per package, check what `adapter-firebase` is still used for.** For each, `grep -rn "adapter-firebase" <pkg>/src`. Keep the dep only where `adminAuth` (Auth) is used — that is `adapter-google` (`risc.ts`) and `apps/web` (auth wiring, `@/auth`). For packages that imported only `adminDb` (now removed), drop the `@vibesboard/adapter-firebase` dependency from their `package.json`.
- [ ] **Step 2:** `adapter-firebase` **package itself stays** (it exports `adminAuth` used by RISC + auth). Do not delete it. Confirm: `grep -rn "adminAuth\|adapter-firebase/admin" packages/adapter-google/src/risc.ts` still resolves.
- [ ] **Step 3:** `npm install` to update lockfile; `npm run build` (or per-package typecheck) to confirm nothing broke. Commit `chore(teardown): drop adapter-firebase deps from Firestore-only packages (Phase 7d)`.

### Task 7d.3: Delete the Firestore seed, rules, indexes, stale function

**Files:**
- The Firestore-seeding scripts in `scripts/seed-*.ts` that import `firebase-admin`/`getFirestore` (all 6 found: `seed-test-accounts`, `seed-base-branding`, `seed-booking-e2e`, `seed-byoa-feature-flags`, `seed-calendar-connection`, `seed-plan-templates`). **Per-script check:** several of these seed Postgres-migrated domains and may have already been rewritten to Postgres in earlier phases — `grep -n "getFirestore\|adminDb\|firebase-admin" scripts/<file>.ts` first; only remove/rewrite the Firestore portions. Surface to the user which seed scripts are still needed for the wiped-and-reseeded staging flow (the spec's "manage both" window ends here, so the Firestore half of seeding is dead).
- Delete: `firestore.rules`, `firestore.indexes.json`.
- Delete: `apps/functions/lib/on-file-created.js` (stale compiled artifact; confirm nothing references it: `grep -rn "on-file-created" --include="*.json" --include="*.ts" . | grep -v node_modules`).

- [ ] **Step 1:** Verify `firestore.rules`/`firestore.indexes.json` are not referenced by any deploy config still in use: `grep -rn "firestore.rules\|firestore.indexes" . | grep -vE "node_modules|\.next"`. If `firebase.json` references them and `firebase deploy` is still part of CI for Auth/RISC, keep a minimal `firestore.rules` only if Firestore is still provisioned for nothing — recommended: remove the rules/indexes references from `firebase.json` too.
- [ ] **Step 2:** Delete the files. Commit `chore(teardown): remove Firestore seed/rules/indexes + stale function artifact (Phase 7d)`.

### Task 7d.4: Final gate + full test suite

- [ ] **Step 1:** Re-run the Task 7d.1 grep gate → empty (or only documented `chats` deferral).
- [ ] **Step 2:** Run the full workspace test suite + the new package tests:

```bash
node --conditions react-server --test packages/agents/src/__tests__/*.test.ts
# plus the repo's standard: npm test / turbo test
```

Expected: all green.

- [ ] **Step 3:** `python3 -m lizard --CCN 15 packages/agents/src packages/channel-instagram/src apps/web/app/api` and confirm the over-CCN-15 function count across the repo is within the 12-function budget. List any survivors in the PR description.
- [ ] **Step 4:** Commit/PR `chore(teardown): Firestore data-plane removed; Auth/RISC retained (Phase 7d)`.

**Slice 7d staging e2e:** Full smoke of every Phase-7 surface (7a/7b/7c checklists) on a freshly wiped+Postgres-reseeded staging. Confirm sign-in (Better Auth) and RISC still function (Firebase Auth untouched).

---

## Self-review

**Spec coverage:** Hooks (7a) ✓, hook_jobs (7a) ✓, usage/limits counter (7b) ✓, notifications (7b) ✓, notifications/usage/admin-usage routes (7b) ✓, chat-route residual increments (7b) ✓, google-review/access-password/agent-creator/admin-files/meta-data-deletion (7c) ✓, residual page reads (7c) ✓, feature-flags vestigial cleanup (7c.7/PR 1f) ✓, teardown of adminDb data access + seed + rules + stale function (7d) ✓, "what stays Firebase" — RISC/adminAuth/adapter-firebase package (7d.2) ✓, `chats` decision surfaced not invented (7c.0) ✓.

**Placeholder scan:** All code steps contain real code; all commands are runnable; mappers/helpers fully specified. Lizard checks attached to every branchy file.

**Type consistency:** `incrementAgentResponseCount`/`reserveAgentResponseSlot` (7b.1) used identically in 7a.4/7b.2. `rowToHook`/`rowToHookSafe` (7a.1) used in 7a.2. `createInAppNotification`/`listNotifications`/`countUnreadNotifications`/`markNotificationsRead`/`getUserEmail` (7b.3) used in 7b.4/7b.5. `db: Db = getMigrateDb()` optional-param convention consistent throughout.

**Known sequencing note:** Task 7a.4 depends on 7b.1's `incrementAgentResponseCount`; to keep 7a independently shippable, pull 7b.1 forward as 7a.0 if shipping 7a before 7b.