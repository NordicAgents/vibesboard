# Phase 6 — Scheduling, Data Connections & Agent Actions (Firestore → Postgres) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the scheduling (calendar connections + bookings + booking enquiries), data (data connections + action logs), and the appointment/data/booking agent tools off Firestore (`adminDb`) onto the existing Postgres Drizzle schema, plus rewrite the deferred `disableAgentsForConnection` as a Drizzle jsonb update — keeping every domain coherent on a single store with no mid-path Firestore/Postgres split.

**Architecture:** Follows the merged Phase 4/5 precedent exactly: Drizzle-direct co-located helpers in each feature package, each taking an optional `db: Db = getMigrateDb()` last param (BYPASSRLS + explicit `tenant_id` filters), `rowToX` mappers that re-emit the legacy `*Document` contract shapes so callers/providers/UI stay unchanged, `uuidv7()` ids generated in app code, and `withTestDb` tests using the BYPASSRLS `adminDb` client for both seeding and assertions. OAuth/API tokens stay AES-encrypted via the existing `crypto-js` util — mappers return ciphertext exactly as the Firestore docs did, so `getValidAccessToken` / `createProvider` / `getValidDataAccessToken` decrypt unchanged. Routes stay thin (auth + validation + helper call + map response) and are verified live on staging (no PG harness in `apps/web`).

**Tech Stack:** TypeScript, Drizzle ORM (`drizzle-orm/postgres-js`), `@vibesboard/adapter-postgres` (schema + `getMigrateDb` + `withTestDb`), `uuidv7`, `crypto-js` (AES), `node --test --conditions react-server`.

---

## Pre-flight: shared facts the engineer must know

- **Token columns (preserve encryption, do NOT change crypto):**
  - `calendar_connections`: `access_token_encrypted`, `refresh_token_encrypted` (both NOT NULL), `api_key_encrypted` (nullable, Cal.com), `api_base_url`, `token_expires_at` (timestamptz, nullable).
  - `data_connections`: `access_token_encrypted`, `refresh_token_encrypted`, `api_token_encrypted` (all nullable), `token_expires_at` (timestamptz, nullable).
  - The current Firestore code stores AES ciphertext in `accessToken`/`refreshToken`/`apiToken`/`apiKey` doc fields. Mappers map ciphertext column → ciphertext doc field 1:1 (no decryption in the mapper). Encryption happens in `createX` helpers using the existing `encryptToken` (reuse the local `crypto-js` `process.env.ENCRYPTION_KEY` impl already present in `packages/scheduling/src/connections.ts` and `packages/data/src/connections.ts`; keep `decryptToken` exported from `@vibesboard/scheduling/connections` because `@vibesboard/data/connections` imports it).
  - **Contract field naming bridge:** the `CalendarConnectionDocument` contract uses `apiKey` / `apiBaseUrl`; the Postgres columns are `api_key_encrypted` / `api_base_url`. The mapper maps `apiKeyEncrypted → apiKey`, `apiBaseUrl → apiBaseUrl`.
- **Timestamps:** all `*At` / `tokenExpiresAt` columns are `timestamptz`; contract docs are ISO strings. Mappers call `.toISOString()`; `tokenExpiresAt` is nullable → map `null` to `''` is WRONG (provider parses it with `new Date()`), instead preserve as ISO string or `undefined` when null. For calendar (NOT NULL business expectation but nullable column) emit `r.tokenExpiresAt?.toISOString() ?? new Date(0).toISOString()`; for data emit `r.tokenExpiresAt?.toISOString()` (optional field).
- **IDs:** `uuidv7()` for all inserts. **Bookings idempotency exception** — see schema-gap note below.
- **RLS:** policies for all five tables already exist (migration `0001_rls_policies.sql`). Helpers use `getMigrateDb()` (BYPASSRLS) with explicit `eq(table.tenantId, tenantId)` filters, matching Phase 5. Tests assert tenant isolation by querying with a wrong tenantId and expecting empty/null.
- **Lizard CCN rule:** CI budget is 12 functions over CCN 15; a 13th fails `complexity-analysis`. The data-tool path and the OAuth callback are branchy. Where a migrated function gains a branch, extract a helper (noted inline per task).
- **Test script gotcha:** `packages/scheduling/package.json` and `packages/booking-enquiries/package.json` test scripts lack `--conditions react-server`. `packages/data` may also. The new helpers import `@vibesboard/adapter-postgres/client`/`schema` (server-only subpath exports). **Add `--conditions react-server` to those test scripts** (Task 6a-0 / 6c-0) so tests resolve the same export condition as `channel-whatsapp`/`agents`.
- **Migration journal gotcha:** latest migration is `0007_channel_contact_unique`. If a migration is needed (Task 6b-0), **hand-write `0008_*.sql` and the matching `meta/0008_snapshot.json` + `_journal.json` entry; do NOT run `db:generate`** (it re-emits stale ALTERs). Verify `withTestDb` applies it by running any 6b test (the harness reads every `drizzle/*.sql`).

### Schema gap to resolve (Task 6b-0): booking idempotency

The Firestore appointment tool used a **deterministic 32-char sha256 hex doc id** (`appointmentDocId(agentId, startTime, attendeeEmail)`) so a retried `book_appointment` after a Google Calendar timeout returns the existing booking instead of double-booking. A 32-char hex string is **not** a valid `uuid`, so it cannot be the Postgres `bookings.id`.

**Resolution:** keep `id = uuidv7()` and enforce idempotency with a **unique constraint on the natural key** `(agent_id, start_time, attendee_email)` where status is active, then `INSERT ... ON CONFLICT DO NOTHING` + re-select. Bookings can be re-created after cancellation, so the natural key must not collide with a cancelled row — use a **partial unique index** on `WHERE status IN ('confirmed','rescheduled')`. This is a genuine gap → hand-written migration `0008_bookings_idempotency.sql`. (Reschedule/cancel/list queries already filter `status in ('confirmed','rescheduled')`, matching.)

---

## Slice 6a — Calendar connections + `disableAgentsForConnection` + scheduling routes

Independently shippable: migrates calendar-connection CRUD + token refresh, rewrites the deferred agent-disable, and flips the scheduling connection/OAuth routes. Bookings/tools stay on Firestore until 6b (no split: the appointment tool reads connections via `getCalendarConnection` — that read flips here and the tool keeps reading forward into Postgres while still writing bookings to Firestore; acceptable because reads only go forward, per the spec's bottom-up rule, and 6b lands before deploy-to-prod regardless).

> Coupling note: if reviewers object to the appointment tool reading PG connections while writing FS bookings during the staging window, merge 6a+6b together. Default: ship separately; staging runs mixed by design.

### Task 6a-0: Add `--conditions react-server` to scheduling test script

**Files:**
- Modify: `packages/scheduling/package.json` (the `"test"` script)

- [ ] **Step 1: Read the current script**

Run: `grep '"test"' packages/scheduling/package.json`
Expected: `"test": "node --experimental-strip-types --test --experimental-test-isolation=none 'src/**/*.test.ts'"`

- [ ] **Step 2: Edit the script to add the condition**

New value:
```json
"test": "node --experimental-strip-types --conditions react-server --test --experimental-test-isolation=none 'src/**/*.test.ts'"
```

- [ ] **Step 3: Commit**

```bash
git add packages/scheduling/package.json
git commit -m "chore(scheduling): add react-server condition to test script"
```

### Task 6a-1: Calendar-connection mapper (`rowToCalendarConnection`)

**Files:**
- Create: `packages/scheduling/src/db.ts`
- Test: `packages/scheduling/src/__tests__/connections.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/scheduling/src/__tests__/connections.test.ts`)

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToCalendarConnection } from '../db.ts'

describe('rowToCalendarConnection', () => {
  test('maps a row to the legacy CalendarConnectionDocument shape', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const doc = rowToCalendarConnection({
      id: 'c1',
      tenantId: 't1',
      provider: 'google_calendar',
      name: 'work',
      calendarId: 'primary',
      accessTokenEncrypted: 'enc-access',
      refreshTokenEncrypted: 'enc-refresh',
      tokenExpiresAt: now,
      apiKeyEncrypted: null,
      apiBaseUrl: null,
      email: 'a@b.com',
      scopes: ['https://www.googleapis.com/auth/calendar'],
      status: 'active',
      connectedBy: 'u1',
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    assert.equal(doc.id, 'c1')
    assert.equal(doc.accessToken, 'enc-access') // still ciphertext
    assert.equal(doc.refreshToken, 'enc-refresh')
    assert.equal(doc.tokenExpiresAt, now.toISOString())
    assert.equal(doc.scopes[0], 'https://www.googleapis.com/auth/calendar')
    assert.equal(doc.apiKey, undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/scheduling && npm test`
Expected: FAIL — `Cannot find module '../db.ts'`.

- [ ] **Step 3: Write the mapper** (`packages/scheduling/src/db.ts`)

```ts
import type { CalendarConnection } from '@vibesboard/adapter-postgres/schema'
import type { CalendarConnectionDocument } from '@vibesboard/contracts'

export const rowToCalendarConnection = (
  r: CalendarConnection,
): CalendarConnectionDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  provider: r.provider,
  name: r.name,
  calendarId: r.calendarId,
  accessToken: r.accessTokenEncrypted,
  refreshToken: r.refreshTokenEncrypted,
  tokenExpiresAt: r.tokenExpiresAt?.toISOString() ?? new Date(0).toISOString(),
  apiKey: r.apiKeyEncrypted ?? undefined,
  apiBaseUrl: r.apiBaseUrl ?? undefined,
  email: r.email ?? undefined,
  scopes: r.scopes ?? [],
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/scheduling && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduling/src/db.ts packages/scheduling/src/__tests__/connections.test.ts
git commit -m "feat(scheduling): add rowToCalendarConnection mapper"
```

### Task 6a-2: Migrate calendar-connection CRUD + token refresh to Postgres

**Files:**
- Modify: `packages/scheduling/src/connections.ts` (replace `adminDb` bodies; keep `encryptToken`/`decryptToken`/`getEncryptionKey` and the startup validation block verbatim)
- Test: `packages/scheduling/src/__tests__/connections.test.ts` (extend)

- [ ] **Step 1: Add failing CRUD tests** (append to the existing test file)

```ts
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  createCalendarConnection,
  getCalendarConnections,
  getCalendarConnection,
  updateConnectionStatus,
  deleteCalendarConnection,
} from '../connections.ts'

async function seedTenant(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t, name: 'Acme', slug: `acme-${t.slice(0, 8)}`, createdBy: u, isPersonal: false,
  })
  return { tenantId: t, userId: u }
}

describe('calendar connection CRUD (postgres)', () => {
  test('create → get → list → updateStatus → delete, tenant-scoped', async () => {
    process.env.ENCRYPTION_KEY = 'test-key-123'
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        {
          tenantId,
          provider: 'google_calendar',
          name: 'work',
          calendarId: 'primary',
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
          tokenExpiresAt: '2030-01-01T00:00:00.000Z',
          email: 'a@b.com',
          scopes: ['s'],
          connectedBy: userId,
        },
        adminDb,
      )
      assert.notEqual(created.accessToken, 'plain-access') // stored encrypted

      const got = await getCalendarConnection(tenantId, created.id, adminDb)
      assert.equal(got?.id, created.id)

      // tenant isolation: wrong tenant cannot see it
      const wrong = await getCalendarConnection(randomUUID(), created.id, adminDb)
      assert.equal(wrong, null)

      const list = await getCalendarConnections(tenantId, adminDb)
      assert.equal(list.length, 1)

      await updateConnectionStatus(tenantId, created.id, 'expired', adminDb)
      const afterStatus = await getCalendarConnection(tenantId, created.id, adminDb)
      assert.equal(afterStatus?.status, 'expired')

      await deleteCalendarConnection(tenantId, created.id, adminDb)
      assert.equal(await getCalendarConnection(tenantId, created.id, adminDb), null)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/scheduling && npm test`
Expected: FAIL — helpers still call `adminDb.collection(...)` (Firestore), no `db` param.

- [ ] **Step 3: Rewrite `connections.ts` CRUD + refresh on Postgres**

Replace the Firestore imports/bodies. Keep the startup-validation block, `getEncryptionKey`, `encryptToken`, and the **exported** `decryptToken` exactly as-is. New top imports:

```ts
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { calendarConnections } from '@vibesboard/adapter-postgres/schema'
import {
  type CalendarConnectionDocument,
  type CalendarProvider,
  type CalendarConnectionStatus,
} from '@vibesboard/contracts'
import { refreshAccessToken } from './google-auth.ts'
import { rowToCalendarConnection } from './db.ts'
import CryptoJS from 'crypto-js'

type Db = PostgresJsDatabase<typeof schema>
```

CRUD bodies:

```ts
export async function createCalendarConnection(
  params: CreateConnectionParams,
  db: Db = getMigrateDb(),
): Promise<CalendarConnectionDocument> {
  const id = uuidv7()
  const [row] = await db
    .insert(calendarConnections)
    .values({
      id,
      tenantId: params.tenantId,
      provider: params.provider,
      name: params.name,
      calendarId: params.calendarId,
      accessTokenEncrypted: encryptToken(params.accessToken),
      refreshTokenEncrypted: encryptToken(params.refreshToken),
      tokenExpiresAt: new Date(params.tokenExpiresAt),
      email: params.email ?? null,
      scopes: params.scopes,
      status: 'active',
      connectedBy: params.connectedBy,
    })
    .returning()
  return rowToCalendarConnection(row)
}

export async function getCalendarConnections(
  tenantId: string,
  db: Db = getMigrateDb(),
): Promise<CalendarConnectionDocument[]> {
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.tenantId, tenantId))
  return rows.map(rowToCalendarConnection)
}

export async function getCalendarConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb(),
): Promise<CalendarConnectionDocument | null> {
  const [row] = await db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.id, connectionId),
      ),
    )
    .limit(1)
  return row ? rowToCalendarConnection(row) : null
}

export async function deleteCalendarConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.id, connectionId),
      ),
    )
}

export async function updateConnectionStatus(
  tenantId: string,
  connectionId: string,
  status: CalendarConnectionStatus,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(calendarConnections)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.id, connectionId),
      ),
    )
}
```

Rewrite `getValidAccessToken` to persist refreshed tokens via Drizzle (keep the 60s buffer + expired-on-failure behavior). It takes a `db` param so the refresh write is testable:

```ts
export async function getValidAccessToken(
  connection: CalendarConnectionDocument,
  db: Db = getMigrateDb(),
): Promise<string> {
  const now = Date.now()
  const expiresAt = new Date(connection.tokenExpiresAt).getTime()
  if (now < expiresAt - 60_000) {
    return decryptToken(connection.accessToken)
  }
  const refreshToken = decryptToken(connection.refreshToken)
  try {
    const refreshed = await refreshAccessToken(refreshToken)
    await db
      .update(calendarConnections)
      .set({
        accessTokenEncrypted: encryptToken(refreshed.accessToken),
        tokenExpiresAt: new Date(refreshed.expiresAt),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(calendarConnections.tenantId, connection.tenantId),
          eq(calendarConnections.id, connection.id),
        ),
      )
    return refreshed.accessToken
  } catch (error) {
    await updateConnectionStatus(connection.tenantId, connection.id, 'expired', db)
    throw new Error(
      `Calendar connection token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
```

> CCN note: `getValidAccessToken` keeps the same two branches it had — no new branch, no extraction needed.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/scheduling && npm test`
Expected: PASS (mapper + CRUD).

- [ ] **Step 5: Commit**

```bash
git add packages/scheduling/src/connections.ts packages/scheduling/src/__tests__/connections.test.ts
git commit -m "feat(scheduling): migrate calendar-connection CRUD + token refresh to Postgres"
```

### Task 6a-3: Rewrite `disableAgentsForConnection` as a Drizzle jsonb update

**Files:**
- Modify: `packages/agents/src/server.ts` (replace lines 97–123; drop the `adminDb` + `Collections` imports once this is the last user — verify with `grep`)
- Test: `packages/agents/src/__tests__/server.test.ts` (extend the existing file)

- [ ] **Step 1: Write the failing test** (append to `server.test.ts`)

```ts
import { disableAgentsForConnection } from '../server.ts'
// (withTestDb, users, tenants, agents already imported in this file; if not, add:)
// import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
// import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
// import { randomUUID } from 'node:crypto'; import { eq } from 'drizzle-orm'

describe('disableAgentsForConnection', () => {
  test('disables availability + scheduling configs referencing the connection', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u = randomUUID(); const t = randomUUID()
      const connId = randomUUID(); const otherConn = randomUUID()
      await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
      await adminDb.insert(tenants).values({
        id: t, name: 'Acme', slug: `acme-${t.slice(0, 8)}`, createdBy: u, isPersonal: false,
      })
      const a1 = randomUUID(); const a2 = randomUUID(); const a3 = randomUUID()
      // a1 references connId via availability config
      await adminDb.insert(agents).values({
        id: a1, tenantId: t, userId: u, name: 'A1', slug: 'a1',
        calendarAvailabilityConfig: { enabled: true, calendarConnectionId: connId },
      })
      // a2 references connId via scheduling config
      await adminDb.insert(agents).values({
        id: a2, tenantId: t, userId: u, name: 'A2', slug: 'a2',
        schedulingConfig: {
          enabled: true, calendarConnectionId: connId, defaultDurationMinutes: 30,
          bufferMinutes: 0, timezone: 'UTC', availableHours: { start: '09:00', end: '17:00' },
          availableDays: [1,2,3,4,5], meetingTitleTemplate: 'x', createMeetLink: false,
        },
      })
      // a3 references a DIFFERENT connection — must stay enabled
      await adminDb.insert(agents).values({
        id: a3, tenantId: t, userId: u, name: 'A3', slug: 'a3',
        schedulingConfig: {
          enabled: true, calendarConnectionId: otherConn, defaultDurationMinutes: 30,
          bufferMinutes: 0, timezone: 'UTC', availableHours: { start: '09:00', end: '17:00' },
          availableDays: [1,2,3,4,5], meetingTitleTemplate: 'x', createMeetLink: false,
        },
      })

      await disableAgentsForConnection(t, connId, adminDb)

      const [r1] = await adminDb.select().from(agents).where(eq(agents.id, a1))
      const [r2] = await adminDb.select().from(agents).where(eq(agents.id, a2))
      const [r3] = await adminDb.select().from(agents).where(eq(agents.id, a3))
      assert.equal(r1.calendarAvailabilityConfig?.enabled, false)
      assert.equal(r2.schedulingConfig?.enabled, false)
      assert.equal(r3.schedulingConfig?.enabled, true) // untouched
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/agents && npm test`
Expected: FAIL — current impl uses `adminDb`/`Collections` (Firestore) and ignores the `db` param.

- [ ] **Step 3: Rewrite the function** (replace `packages/agents/src/server.ts:97-123`)

Use a `jsonb` containment filter to find matching agents and `jsonb_set` to flip `enabled`. Extract the per-column update into a helper to keep CCN low and avoid duplicating the SQL.

```ts
import { sql } from 'drizzle-orm' // ensure imported (and/eq/desc/inArray already present)

async function disableConfigField(
  db: Db,
  tenantId: string,
  connectionId: string,
  column:
    | typeof agentsTable.calendarAvailabilityConfig
    | typeof agentsTable.schedulingConfig,
): Promise<void> {
  await db
    .update(agentsTable)
    .set({
      // set <column>->'enabled' = false, leaving the rest of the jsonb intact
      ...(column === agentsTable.calendarAvailabilityConfig
        ? {
            calendarAvailabilityConfig: sql`jsonb_set(${agentsTable.calendarAvailabilityConfig}, '{enabled}', 'false'::jsonb)`,
          }
        : {
            schedulingConfig: sql`jsonb_set(${agentsTable.schedulingConfig}, '{enabled}', 'false'::jsonb)`,
          }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentsTable.tenantId, tenantId),
        sql`${column} ->> 'calendarConnectionId' = ${connectionId}`,
      ),
    )
}

export async function disableAgentsForConnection(
  tenantId: string,
  connectionId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await disableConfigField(db, tenantId, connectionId, agentsTable.calendarAvailabilityConfig)
  await disableConfigField(db, tenantId, connectionId, agentsTable.schedulingConfig)
}
```

Then remove the now-unused Firestore imports if nothing else in `server.ts` uses them:

Run: `grep -n "adminDb\|Collections" packages/agents/src/server.ts`
If zero remaining hits beyond the imports, delete the `import { adminDb } ...` and `Collections` import lines. (Per the brief this is the *only* remaining Firestore use in `server.ts`, so they should be removable — confirm.)

> CCN note: extracting `disableConfigField` keeps `disableAgentsForConnection` trivial (CCN 1) and avoids a 13th >15 function.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/agents && npm test`
Expected: PASS.

- [ ] **Step 5: Verify the package has no remaining Firestore in server.ts**

Run: `grep -c "adminDb" packages/agents/src/server.ts`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/server.ts packages/agents/src/__tests__/server.test.ts
git commit -m "feat(agents): rewrite disableAgentsForConnection as Drizzle jsonb update"
```

### Task 6a-4: Confirm scheduling routes need no change + lint/typecheck

The scheduling routes (`connections/route.ts`, `connections/[id]/route.ts`, `connections/[id]/calendars/route.ts`, `auth/google/callback/route.ts`) call the package functions by the **same names with the same signatures** (the `db` param is optional, defaulting to `getMigrateDb()`), so they require **no edits**. Verify nothing in those routes imports `adminDb` directly for scheduling collections.

- [ ] **Step 1: Verify no direct Firestore in scheduling routes**

Run: `grep -rn "adminDb\|Collections.calendarConnections\|Collections.bookings" apps/web/app/api/scheduling/`
Expected: no matches (the OAuth callback only calls `createCalendarConnection`).

- [ ] **Step 2: Typecheck the touched packages + app**

Run: `cd packages/scheduling && npm run typecheck && cd ../agents && npm run typecheck`
Expected: clean. (If `apps/web` has a typecheck script, run it too.)

- [ ] **Step 3: Run the CCN/complexity gate**

Run: `npm run complexity-analysis` (root) — or the script named in CI.
Expected: still ≤12 functions over CCN 15.

- [ ] **Step 4: Commit any lint fixups**

```bash
git add -A
git commit -m "chore(scheduling): typecheck + complexity gate for phase 6a"
```

**6a staging verification (post-deploy, API/DB-level — no live Google OAuth needed):**
1. `GET /api/scheduling/connections` returns `200` with `{ connections: [...] }` from Postgres (seed one row directly in PG, or via the OAuth flow if driveable).
2. With a seeded calendar_connection + an agent whose `schedulingConfig.calendarConnectionId` points at it, `DELETE /api/scheduling/connections/[id]` returns `200 { success: true }`, the row is gone from `calendar_connections`, and the agent's `scheduling_config->>'enabled'` is now `false` (verify with a SQL `SELECT`).
3. `GET /api/scheduling/connections/[id]/calendars` returns `404` for an unknown id and `400 CONNECTION_INACTIVE` for a non-active connection (DB-level paths, no Google call).

---

## Slice 6b — Bookings + booking enquiries + appointments tool + booking-enquiries package + route

Independently shippable: migrates the booking write path (appointment tool), the `booking_enquiries` write/read path (booking-enquiries package + the booking action tool + the GET route), and adds the idempotency migration. Reads forward into the 6a Postgres calendar connections.

### Task 6b-0: Hand-write migration `0008_bookings_idempotency.sql`

**Files:**
- Create: `packages/adapter-postgres/drizzle/0008_bookings_idempotency.sql`
- Modify: `packages/adapter-postgres/drizzle/meta/_journal.json` (append entry), create `packages/adapter-postgres/drizzle/meta/0008_snapshot.json`
- Modify: `packages/adapter-postgres/src/schema/scheduling.ts` (add the partial unique index to the `bookings` table definition so schema + DB agree)

- [ ] **Step 1: Add the partial unique index to the schema**

In `scheduling.ts`, inside the `bookings` table's third arg, add:

```ts
import { sql } from 'drizzle-orm'
// ...
(t) => ({
  byAgent: index('bookings_agent_idx').on(t.agentId, t.startTime),
  byCal: index('bookings_calendar_idx').on(t.calendarConnectionId, t.startTime),
  activeNaturalKey: uniqueIndex('bookings_active_natural_key')
    .on(t.agentId, t.startTime, t.attendeeEmail)
    .where(sql`${t.status} in ('confirmed','rescheduled')`),
}),
```
(Add `uniqueIndex` to the `drizzle-orm/pg-core` import.)

- [ ] **Step 2: Hand-write the migration SQL** (`0008_bookings_idempotency.sql`)

```sql
CREATE UNIQUE INDEX "bookings_active_natural_key"
  ON "public"."bookings" ("agent_id", "start_time", "attendee_email")
  WHERE "status" IN ('confirmed', 'rescheduled');
```

- [ ] **Step 3: Append the journal entry + snapshot**

Add to `meta/_journal.json` `entries` (bump `idx`, set `tag` to `0008_bookings_idempotency`, copy the `version`/`when` shape from entry 0007). Create `meta/0008_snapshot.json` by copying `0007`'s snapshot and adding the new index to the `bookings` table's `indexes` map. **Do NOT run `db:generate`.**

- [ ] **Step 4: Verify the harness applies it (write a throwaway probe test, then delete)**

Run: `cd packages/scheduling && npm test` (the 6b tests in 6b-2 will exercise it; if running before those exist, temporarily assert `withTestDb` boots without error).
Expected: no SQL error applying `0008` (the `withTestDb` loop reads every `drizzle/*.sql`).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-postgres/drizzle/0008_bookings_idempotency.sql packages/adapter-postgres/drizzle/meta packages/adapter-postgres/src/schema/scheduling.ts
git commit -m "feat(db): add bookings active-natural-key partial unique index (0008)"
```

### Task 6b-1: Booking mapper + enquiry mapper

**Files:**
- Modify: `packages/scheduling/src/db.ts` (add `rowToBooking`)
- Create: `packages/booking-enquiries/src/db.ts` (add `rowToBookingEnquiry`)
- Test: `packages/scheduling/src/__tests__/connections.test.ts` (add `rowToBooking` test); `packages/booking-enquiries/src/__tests__/enquiries.test.ts`

- [ ] **Step 1: Write failing mapper tests**

In `packages/scheduling/src/__tests__/connections.test.ts` add:

```ts
import { rowToBooking } from '../db.ts'

describe('rowToBooking', () => {
  test('maps a booking row to BookingDocument', () => {
    const now = new Date('2026-05-25T10:00:00.000Z')
    const end = new Date('2026-05-25T10:30:00.000Z')
    const doc = rowToBooking({
      id: 'b1', tenantId: 't1', agentId: 'a1', conversationId: null,
      calendarConnectionId: 'c1', provider: 'google_calendar', externalEventId: 'evt1',
      title: 'Call', startTime: now, endTime: end, timezone: 'UTC',
      attendeeName: 'Jane', attendeeEmail: 'jane@x.com', description: null, meetLink: null,
      status: 'confirmed', cancelledAt: null, rescheduledTo: null, createdAt: now, updatedAt: now,
    })
    assert.equal(doc.id, 'b1')
    assert.equal(doc.conversationId, '') // null → '' (contract is non-optional string)
    assert.equal(doc.startTime, now.toISOString())
    assert.equal(doc.status, 'confirmed')
  })
})
```

Create `packages/booking-enquiries/src/__tests__/enquiries.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToBookingEnquiry } from '../db.ts'

describe('rowToBookingEnquiry', () => {
  test('maps an enquiry row to BookingEnquiryDocument', () => {
    const start = new Date('2026-05-25T10:00:00.000Z')
    const end = new Date('2026-05-25T12:00:00.000Z')
    const created = new Date('2026-05-24T00:00:00.000Z')
    const doc = rowToBookingEnquiry({
      id: 'e1', tenantId: 't1', agentId: 'a1', resourceName: 'Glass Cabin',
      calendarId: 'cal1', calendarName: 'Cabins', timezone: 'Europe/Stockholm',
      startDatetime: start, endDatetime: end, guestName: 'Ada', guestEmail: 'ada@x.com',
      guestPhone: '+46', guestCount: 2, notes: 'window seat', createdAt: created,
    })
    assert.equal(doc.id, 'e1')
    assert.equal(doc.startDatetime, start.toISOString())
    assert.equal(doc.guestCount, 2)
  })
})
```

- [ ] **Step 2: Run both, verify fail**

Run: `cd packages/scheduling && npm test` then `cd ../booking-enquiries && npm test`
Expected: FAIL — `rowToBooking` / `../db.ts` missing.

- [ ] **Step 3: Add the mappers**

Append to `packages/scheduling/src/db.ts`:

```ts
import type { Booking } from '@vibesboard/adapter-postgres/schema'
import type { BookingDocument } from '@vibesboard/contracts'

export const rowToBooking = (r: Booking): BookingDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  conversationId: r.conversationId ?? '',
  calendarConnectionId: r.calendarConnectionId,
  provider: r.provider,
  externalEventId: r.externalEventId,
  title: r.title,
  startTime: r.startTime.toISOString(),
  endTime: r.endTime.toISOString(),
  timezone: r.timezone,
  attendeeName: r.attendeeName,
  attendeeEmail: r.attendeeEmail,
  description: r.description ?? undefined,
  meetLink: r.meetLink ?? undefined,
  status: r.status,
  cancelledAt: r.cancelledAt?.toISOString() ?? undefined,
  rescheduledTo: r.rescheduledTo ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
```

Create `packages/booking-enquiries/src/db.ts`:

```ts
import type { BookingEnquiry } from '@vibesboard/adapter-postgres/schema'
import type { BookingEnquiryDocument } from '@vibesboard/contracts'

export const rowToBookingEnquiry = (
  r: BookingEnquiry,
): BookingEnquiryDocument => ({
  id: r.id,
  agentId: r.agentId,
  tenantId: r.tenantId,
  resourceName: r.resourceName,
  calendarId: r.calendarId,
  calendarName: r.calendarName,
  timezone: r.timezone,
  startDatetime: r.startDatetime.toISOString(),
  endDatetime: r.endDatetime.toISOString(),
  guestName: r.guestName,
  guestEmail: r.guestEmail,
  guestPhone: r.guestPhone,
  guestCount: r.guestCount ?? undefined,
  notes: r.notes ?? undefined,
  createdAt: r.createdAt.toISOString(),
})
```

Add `--conditions react-server` to `packages/booking-enquiries/package.json` test script now (same edit as Task 6a-0).

- [ ] **Step 4: Run both, verify pass**

Run: `cd packages/scheduling && npm test` then `cd ../booking-enquiries && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduling/src/db.ts packages/booking-enquiries/src/db.ts packages/booking-enquiries/package.json packages/scheduling/src/__tests__/connections.test.ts packages/booking-enquiries/src/__tests__/enquiries.test.ts
git commit -m "feat(scheduling,booking-enquiries): add rowToBooking + rowToBookingEnquiry mappers"
```

### Task 6b-2: Booking persistence helpers (idempotent create + find/update for reschedule/cancel/list)

The appointment tool currently inlines Firestore reads/writes. Extract the DB work into testable helpers in a new `packages/scheduling/src/bookings.ts` so the tool stays thin and the hot path is coherent on Postgres.

**Files:**
- Create: `packages/scheduling/src/bookings.ts`
- Test: `packages/scheduling/src/__tests__/bookings.test.ts`

- [ ] **Step 1: Write failing tests** (`bookings.test.ts`)

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, calendarConnections } from '@vibesboard/adapter-postgres/schema'
import {
  upsertBooking,
  findActiveBookingByAttendee,
  setBookingStatus,
  listBookingsForDay,
} from '../bookings.ts'

async function seed(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID(); const c = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: 'a' })
  await adminDb.insert(calendarConnections).values({
    id: c, tenantId: t, provider: 'google_calendar', name: 'w', calendarId: 'primary',
    accessTokenEncrypted: 'e', refreshTokenEncrypted: 'r', scopes: [], connectedBy: u,
  })
  return { tenantId: t, agentId: a, connId: c }
}

describe('booking persistence', () => {
  test('upsertBooking is idempotent on (agent,start,email) for active bookings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const base = {
        tenantId, agentId, calendarConnectionId: connId, provider: 'google_calendar' as const,
        externalEventId: 'evt1', title: 'Call', startTime: '2026-05-25T10:00:00.000Z',
        endTime: '2026-05-25T10:30:00.000Z', timezone: 'UTC', attendeeName: 'Jane',
        attendeeEmail: 'jane@x.com',
      }
      const first = await upsertBooking(base, adminDb)
      const second = await upsertBooking({ ...base, externalEventId: 'evt2' }, adminDb)
      assert.equal(first.id, second.id) // same booking returned, no duplicate
      assert.equal(second.externalEventId, 'evt1') // original kept (DO NOTHING)
    })
  })

  test('findActiveBookingByAttendee + setBookingStatus cancels', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      await upsertBooking({
        tenantId, agentId, calendarConnectionId: connId, provider: 'google_calendar',
        externalEventId: 'evt1', title: 'Call', startTime: '2026-05-25T10:00:00.000Z',
        endTime: '2026-05-25T10:30:00.000Z', timezone: 'UTC', attendeeName: 'Jane',
        attendeeEmail: 'jane@x.com',
      }, adminDb)
      const found = await findActiveBookingByAttendee(
        tenantId, agentId, 'jane@x.com', '2026-05-25T10:00:00.000Z', adminDb,
      )
      assert.ok(found)
      await setBookingStatus(tenantId, found!.id, { status: 'cancelled', cancelledAt: new Date().toISOString() }, adminDb)
      const day = await listBookingsForDay(tenantId, agentId, '2026-05-25', null, adminDb)
      assert.equal(day.length, 0) // cancelled excluded from active list
    })
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/scheduling && npm test`
Expected: FAIL — `../bookings.ts` missing.

- [ ] **Step 3: Implement `bookings.ts`**

```ts
import { and, eq, gte, lte, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { bookings } from '@vibesboard/adapter-postgres/schema'
import type { BookingDocument, CalendarProvider } from '@vibesboard/contracts'
import { rowToBooking } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>
const ACTIVE = ['confirmed', 'rescheduled'] as const

export interface UpsertBookingParams {
  tenantId: string
  agentId: string
  conversationId?: string | null
  calendarConnectionId: string
  provider: CalendarProvider
  externalEventId: string
  title: string
  startTime: string
  endTime: string
  timezone: string
  attendeeName: string
  attendeeEmail: string
  description?: string
  meetLink?: string
}

/**
 * Insert a booking, idempotent on the active natural key
 * (agent_id, start_time, attendee_email). On conflict the existing active
 * booking is returned — mirrors the deterministic-id retry behavior so a
 * Google Calendar timeout retry never double-books.
 */
export async function upsertBooking(
  p: UpsertBookingParams,
  db: Db = getMigrateDb(),
): Promise<BookingDocument> {
  const inserted = await db
    .insert(bookings)
    .values({
      id: uuidv7(),
      tenantId: p.tenantId,
      agentId: p.agentId,
      conversationId: p.conversationId ?? null,
      calendarConnectionId: p.calendarConnectionId,
      provider: p.provider,
      externalEventId: p.externalEventId,
      title: p.title,
      startTime: new Date(p.startTime),
      endTime: new Date(p.endTime),
      timezone: p.timezone,
      attendeeName: p.attendeeName,
      attendeeEmail: p.attendeeEmail,
      description: p.description ?? null,
      meetLink: p.meetLink ?? null,
      status: 'confirmed',
    })
    .onConflictDoNothing({ target: bookings.activeNaturalKey })
    .returning()
  if (inserted[0]) return rowToBooking(inserted[0])
  // Conflict: an active booking already exists — return it.
  const existing = await findActiveBookingByAttendee(
    p.tenantId, p.agentId, p.attendeeEmail, p.startTime, db,
  )
  return existing!
}

export async function findActiveBookingByAttendee(
  tenantId: string,
  agentId: string,
  attendeeEmail: string,
  startTime: string,
  db: Db = getMigrateDb(),
): Promise<BookingDocument | null> {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.agentId, agentId),
        eq(bookings.attendeeEmail, attendeeEmail),
        inArray(bookings.status, ACTIVE as unknown as string[]),
      ),
    )
  const target = new Date(startTime).getTime()
  const match = rows.find(
    (r) => Math.abs(r.startTime.getTime() - target) < 60_000, // 1-min tolerance
  )
  return match ? rowToBooking(match) : null
}

export async function setBookingStatus(
  tenantId: string,
  bookingId: string,
  patch: {
    status: 'cancelled' | 'rescheduled'
    startTime?: string
    endTime?: string
    cancelledAt?: string
  },
  db: Db = getMigrateDb(),
): Promise<void> {
  await db
    .update(bookings)
    .set({
      status: patch.status,
      ...(patch.startTime ? { startTime: new Date(patch.startTime) } : {}),
      ...(patch.endTime ? { endTime: new Date(patch.endTime) } : {}),
      ...(patch.cancelledAt ? { cancelledAt: new Date(patch.cancelledAt) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
}

export async function listBookingsForDay(
  tenantId: string,
  agentId: string,
  date: string, // YYYY-MM-DD
  attendeeEmail: string | null,
  db: Db = getMigrateDb(),
): Promise<BookingDocument[]> {
  const dayStart = new Date(`${date}T00:00:00.000Z`)
  const dayEnd = new Date(`${date}T23:59:59.999Z`)
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.agentId, agentId),
        gte(bookings.startTime, dayStart),
        lte(bookings.startTime, dayEnd),
        inArray(bookings.status, ACTIVE as unknown as string[]),
      ),
    )
    .orderBy(bookings.startTime)
  const mapped = rows.map(rowToBooking)
  return attendeeEmail
    ? mapped.filter((b) => b.attendeeEmail.toLowerCase() === attendeeEmail.toLowerCase())
    : mapped
}
```

> CCN note: each helper is single-branch; `upsertBooking` has one post-conflict branch. No function exceeds CCN 15.

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/scheduling && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduling/src/bookings.ts packages/scheduling/src/__tests__/bookings.test.ts
git commit -m "feat(scheduling): add Postgres booking persistence helpers"
```

### Task 6b-3: Rewire the appointments tool onto the booking helpers

**Files:**
- Modify: `packages/ai/src/actions/appointments/tools.ts` (replace `adminDb`/`Collections`/`appointmentDocId` usage with the 6b-2 helpers)

- [ ] **Step 1: Replace imports + delete `appointmentDocId`**

Remove:
```ts
import { createHash } from 'crypto'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections, type BookingDocument, ... } from '@vibesboard/contracts'
```
Add:
```ts
import { type BookingDocument, type CalendarConnectionDocument, type VibeAgent } from '@vibesboard/contracts'
import { getCalendarConnection, getValidAccessToken } from '@vibesboard/scheduling/connections'
import {
  upsertBooking,
  findActiveBookingByAttendee,
  setBookingStatus,
  listBookingsForDay,
} from '@vibesboard/scheduling/bookings'
```
Delete the `appointmentDocId` function entirely (idempotency now lives in the DB constraint).

- [ ] **Step 2: Rewrite `buildBookAppointmentTool` execute body**

Replace the Firestore `bookingRef`/`existingSnap`/`bookingRef.set` block with:

```ts
const accessToken = await getValidAccessToken(ctx.connection)
const provider = createProvider(ctx.connection, accessToken)
const result = await provider.createEvent({ /* unchanged args */ })

const booking = await upsertBooking({
  tenantId: ctx.agent.tenantId!,
  agentId: ctx.agent.id,
  calendarConnectionId: ctx.connection.id,
  provider: ctx.connection.provider,
  externalEventId: result.eventId,
  title,
  startTime,
  endTime,
  timezone: ctx.config.timezone,
  attendeeName,
  attendeeEmail,
  description: args.description ? String(args.description) : (ctx.config.meetingDescription ?? undefined),
  meetLink: result.meetLink,
})
// `booking` is the active row (new or pre-existing on retry) — format from it.
```
Build the confirmation `lines` from `booking` (use `booking.meetLink`, `booking.startTime`). The "already booked" idempotent message can be unified into the single confirmation since `upsertBooking` returns the existing row on conflict.

- [ ] **Step 3: Rewrite reschedule/cancel/list bodies**

- `buildRescheduleAppointmentTool`: replace the Firestore query+find with
  `const booking = await findActiveBookingByAttendee(ctx.agent.tenantId!, ctx.agent.id, attendeeEmail, originalStartTime)`; after `provider.updateEvent(...)`, call
  `await setBookingStatus(ctx.agent.tenantId!, booking.id, { status: 'rescheduled', startTime: newStartTime, endTime: newEndTime })`.
- `buildCancelAppointmentTool`: `const booking = await findActiveBookingByAttendee(...)`; after `provider.deleteEvent(...)`, call
  `await setBookingStatus(ctx.agent.tenantId!, booking.id, { status: 'cancelled', cancelledAt: new Date().toISOString() })`.
- `buildListAppointmentsTool`: replace the Firestore range query with
  `const bookings = await listBookingsForDay(ctx.agent.tenantId!, ctx.agent.id, date, attendeeEmail, undefined)` (helper already sorts + filters).

> CCN note: each tool's `execute` loses branches (no more in-memory find/sort/filter) — net CCN decrease. No extraction needed.

- [ ] **Step 4: Typecheck**

Run: `cd packages/ai && npm run typecheck`
Expected: clean. (No package test harness change — the tool path is covered by `packages/scheduling` helper tests + staging.)

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/actions/appointments/tools.ts
git commit -m "feat(ai): rewire appointments tool onto Postgres booking helpers"
```

### Task 6b-4: Migrate booking-enquiries package (`createEnquiry`) + the GET route

**Files:**
- Modify: `packages/booking-enquiries/src/create.ts` (Postgres insert via Drizzle; keep the fire-and-forget `notifyAdminOfEnquiry`)
- Modify: `packages/booking-enquiries/src/notify.ts` (the admin-email fallback reads `users` from Firestore — migrate that read to Postgres `users` via `getMigrateDb`)
- Modify: `apps/web/app/api/booking-enquiries/route.ts` (GET list from Postgres)
- Create: `packages/booking-enquiries/src/list.ts` (a `listEnquiriesForAgent` helper so the route stays thin)
- Test: `packages/booking-enquiries/src/__tests__/enquiries.test.ts` (extend)

- [ ] **Step 1: Write failing create+list tests** (append)

```ts
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { createEnquiry } from '../create.ts'
import { listEnquiriesForAgent } from '../list.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: 'a' })
  return { tenantId: t, agentId: a }
}

describe('enquiry create + list (postgres)', () => {
  test('createEnquiry persists and listEnquiriesForAgent returns it', async () => {
    delete process.env.RESEND_API_KEY // skip email
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const agent = { id: agentId, tenantId } as any
      const id = await createEnquiry({
        agent, resourceName: 'Glass Cabin', calendarId: 'cal1', calendarName: 'Cabins',
        timezone: 'UTC', startDatetime: '2026-05-25T10:00:00.000Z',
        endDatetime: '2026-05-25T12:00:00.000Z', guestName: 'Ada', guestEmail: 'ada@x.com',
        guestPhone: '+46', guestCount: 2, notes: 'window',
      }, adminDb)
      const list = await listEnquiriesForAgent(tenantId, agentId, 100, adminDb)
      assert.equal(list.length, 1)
      assert.equal(list[0].id, id)
      assert.equal(list[0].guestName, 'Ada')
    })
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/booking-enquiries && npm test`
Expected: FAIL — `createEnquiry` still uses `adminDb` and ignores `db`; `../list.ts` missing.

- [ ] **Step 3: Rewrite `create.ts`**

```ts
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { bookingEnquiries } from '@vibesboard/adapter-postgres/schema'
import { type BookingEnquiryDocument, type VibeAgent } from '@vibesboard/contracts'
import { rowToBookingEnquiry } from './db.ts'
import { notifyAdminOfEnquiry } from './notify.ts'

type Db = PostgresJsDatabase<typeof schema>

export interface CreateEnquiryParams { /* unchanged */ }

export async function createEnquiry(
  params: CreateEnquiryParams,
  db: Db = getMigrateDb(),
): Promise<string> {
  const id = uuidv7()
  const [row] = await db
    .insert(bookingEnquiries)
    .values({
      id,
      tenantId: params.agent.tenantId!,
      agentId: params.agent.id,
      resourceName: params.resourceName,
      calendarId: params.calendarId,
      calendarName: params.calendarName,
      timezone: params.timezone,
      startDatetime: new Date(params.startDatetime),
      endDatetime: new Date(params.endDatetime),
      guestName: params.guestName,
      guestEmail: params.guestEmail,
      guestPhone: params.guestPhone,
      guestCount: params.guestCount ?? null,
      notes: params.notes ?? null,
    })
    .returning()
  const doc = rowToBookingEnquiry(row)
  // Fire-and-forget — email failure must not break the guest's submission
  notifyAdminOfEnquiry(params.agent, doc).catch((err) =>
    console.error('[booking-enquiry] Failed to notify admin:', err),
  )
  return id
}
```

> Note: `startDatetime`/`endDatetime` are wall-clock strings (`2026-05-10T14:00`) in the enquiry timezone. `new Date('2026-05-10T14:00')` parses as **local** time, then `.toISOString()` in the mapper would shift it. To preserve the wall-clock exactly, store and read as a `timestamptz` is lossy for wall-clock semantics. **Decision:** the column is `timestamptz`; the existing `notify.ts` `fmt()` re-parses the string components at UTC. To keep the round-trip stable, normalize on write by appending `Z` if no offset is present: `new Date(/[Z+]/.test(s) ? s : s + 'Z')`. Add a tiny `toUtcDate(s: string)` helper in `create.ts` and use it for both datetimes; the mapper's `.toISOString()` then returns the same wall-clock with `Z`, matching `notify.ts`'s UTC formatting. Add an assertion in the test: `assert.equal(list[0].startDatetime, '2026-05-25T10:00:00.000Z')`.

- [ ] **Step 4: Migrate the `notify.ts` owner-email fallback to Postgres**

Replace the Firestore `users` read:
```ts
import { eq } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { users as usersTable } from '@vibesboard/adapter-postgres/schema'
// ...
if (!toAddress && agent.userId) {
  const [u] = await getMigrateDb()
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, agent.userId))
    .limit(1)
  toAddress = u?.email ?? null
}
```
Remove the `adminDb` + `Collections` imports from `notify.ts`.

- [ ] **Step 5: Create `list.ts`**

```ts
import { and, eq, desc } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { bookingEnquiries } from '@vibesboard/adapter-postgres/schema'
import type { BookingEnquiryDocument } from '@vibesboard/contracts'
import { rowToBookingEnquiry } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>

export async function listEnquiriesForAgent(
  tenantId: string,
  agentId: string,
  limit = 100,
  db: Db = getMigrateDb(),
): Promise<BookingEnquiryDocument[]> {
  const rows = await db
    .select()
    .from(bookingEnquiries)
    .where(and(eq(bookingEnquiries.tenantId, tenantId), eq(bookingEnquiries.agentId, agentId)))
    .orderBy(desc(bookingEnquiries.createdAt))
    .limit(limit)
  return rows.map(rowToBookingEnquiry)
}
```
Add `export * from './list.ts'` to `packages/booking-enquiries/src/index.ts`.

- [ ] **Step 6: Run, verify pass**

Run: `cd packages/booking-enquiries && npm test`
Expected: PASS.

- [ ] **Step 7: Rewrite the GET route to use Postgres**

Replace `apps/web/app/api/booking-enquiries/route.ts` body. Verify the agent belongs to the tenant via the already-migrated `getAgentForMember` from `@vibesboard/agents/server`, then `listEnquiriesForAgent`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { getAgentForMember } from '@vibesboard/agents/server'
import { listEnquiriesForAgent } from '@vibesboard/booking-enquiries'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) return NextResponse.json({ error: 'No active tenant' }, { status: 403 })
  const agentId = new URL(req.url).searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
  const agent = await getAgentForMember(tenantId, agentId)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const enquiries = await listEnquiriesForAgent(tenantId, agentId, 100)
  return NextResponse.json({ enquiries })
}
```

- [ ] **Step 8: Verify no Firestore left in the route + typecheck**

Run: `grep -n "adminDb" apps/web/app/api/booking-enquiries/route.ts` (expect none)
Run: `cd packages/booking-enquiries && npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/booking-enquiries/src/create.ts packages/booking-enquiries/src/notify.ts packages/booking-enquiries/src/list.ts packages/booking-enquiries/src/index.ts apps/web/app/api/booking-enquiries/route.ts packages/booking-enquiries/src/__tests__/enquiries.test.ts
git commit -m "feat(booking-enquiries): migrate create/list/notify + GET route to Postgres"
```

### Task 6b-5: Confirm the booking action tool (`actions/booking/tools.ts`) is coherent

This tool calls `createEnquiry` (now Postgres) via dynamic import and reads connections via `getCalendarConnection` (Postgres after 6a). No DB writes are inlined here beyond `createEnquiry`. Verify it has no direct `adminDb` usage.

- [ ] **Step 1: Grep the booking tool**

Run: `grep -n "adminDb\|Collections" packages/ai/src/actions/booking/tools.ts`
Expected: no matches. If any exist (e.g. a stray bookings read), extract a helper into `packages/scheduling/src/bookings.ts` and reuse it (CCN budget).

- [ ] **Step 2: Typecheck ai**

Run: `cd packages/ai && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run complexity gate**

Run: `npm run complexity-analysis`
Expected: ≤12 over CCN 15.

- [ ] **Step 4: Commit (if anything changed)**

```bash
git add -A
git commit -m "chore(ai): confirm booking tool coherent on Postgres"
```

**6b staging verification (post-deploy, API/DB-level):**
1. Trigger `book_appointment` twice with identical `(start_time, attendee_email)` (via a chat against an agent with scheduling enabled, or directly call `upsertBooking` against staging PG): exactly **one** `bookings` row exists with that natural key, status `confirmed`.
2. `cancel_appointment` flips that row to `cancelled` (SQL `SELECT status`).
3. Submit a booking enquiry via the booking action (`mode: 'enquiry'`): one `booking_enquiries` row persists; `GET /api/booking-enquiries?agentId=...` returns `200` listing it; a `404` for an agent in another tenant.

---

## Slice 6c — Data connections + data action logs + data tool + data routes

Independently shippable: migrates data-connection CRUD + token refresh, the data action log writes, the data agent tool path, and the data connection routes.

### Task 6c-0: Add `--conditions react-server` to data test script

**Files:**
- Modify: `packages/data/package.json` (test script)

- [ ] **Step 1: Check + edit**

Run: `grep '"test"' packages/data/package.json`
If it lacks `--conditions react-server`, add it (same form as Task 6a-0).

- [ ] **Step 2: Commit**

```bash
git add packages/data/package.json
git commit -m "chore(data): add react-server condition to test script"
```

### Task 6c-1: Data-connection mapper (`rowToDataConnection`)

**Files:**
- Create: `packages/data/src/db.ts`
- Test: `packages/data/src/__tests__/connections.test.ts`

- [ ] **Step 1: Write failing mapper test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToDataConnection } from '../db.ts'

describe('rowToDataConnection', () => {
  test('maps a google_sheets row preserving ciphertext + optional fields', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const doc = rowToDataConnection({
      id: 'd1', tenantId: 't1', provider: 'google_sheets', name: 'sheet',
      accessTokenEncrypted: 'enc-a', refreshTokenEncrypted: 'enc-r', tokenExpiresAt: now,
      email: 'a@b.com', spreadsheetId: 'ss1', sheetName: 'Sheet1', scopes: ['s'],
      apiTokenEncrypted: null, baseId: null, tableId: null, tableName: null,
      webhookUrl: null, webhookMethod: null, webhookHeaders: null,
      status: 'active', connectedBy: 'u1', connectedAt: now, createdAt: now, updatedAt: now,
    })
    assert.equal(doc.accessToken, 'enc-a')
    assert.equal(doc.tokenExpiresAt, now.toISOString())
    assert.equal(doc.spreadsheetId, 'ss1')
    assert.equal(doc.apiToken, undefined)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/data && npm test`
Expected: FAIL — `../db.ts` missing.

- [ ] **Step 3: Write the mapper**

```ts
import type { DataConnection } from '@vibesboard/adapter-postgres/schema'
import type { DataConnectionDocument } from '@vibesboard/contracts'

export const rowToDataConnection = (
  r: DataConnection,
): DataConnectionDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  provider: r.provider,
  name: r.name,
  accessToken: r.accessTokenEncrypted ?? undefined,
  refreshToken: r.refreshTokenEncrypted ?? undefined,
  tokenExpiresAt: r.tokenExpiresAt?.toISOString(),
  email: r.email ?? undefined,
  spreadsheetId: r.spreadsheetId ?? undefined,
  sheetName: r.sheetName ?? undefined,
  scopes: r.scopes ?? undefined,
  apiToken: r.apiTokenEncrypted ?? undefined,
  baseId: r.baseId ?? undefined,
  tableId: r.tableId ?? undefined,
  tableName: r.tableName ?? undefined,
  webhookUrl: r.webhookUrl ?? undefined,
  webhookMethod: r.webhookMethod ?? undefined,
  webhookHeaders: r.webhookHeaders ?? undefined,
  status: r.status,
  connectedBy: r.connectedBy ?? '',
  connectedAt: r.connectedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})
```

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/data && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/db.ts packages/data/src/__tests__/connections.test.ts
git commit -m "feat(data): add rowToDataConnection mapper"
```

### Task 6c-2: Migrate data-connection CRUD + token refresh to Postgres

**Files:**
- Modify: `packages/data/src/connections.ts` (replace `adminDb`; keep importing `decryptToken` from `@vibesboard/scheduling/connections`)
- Test: `packages/data/src/__tests__/connections.test.ts` (extend)

- [ ] **Step 1: Write failing CRUD tests** (append; seed tenant helper as in 6a-2)

```ts
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  createDataConnection, getDataConnections, getDataConnection,
  updateDataConnection, updateDataConnectionStatus, deleteDataConnection,
} from '../connections.ts'

describe('data connection CRUD (postgres)', () => {
  test('airtable create → get → list → update → status → delete', async () => {
    process.env.ENCRYPTION_KEY = 'test-key-123'
    await withTestDb(async ({ adminDb }) => {
      const u = randomUUID(); const t = randomUUID()
      await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
      await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })

      const created = await createDataConnection({
        provider: 'airtable', tenantId: t, apiToken: 'plain-token',
        baseId: 'b1', tableId: 'tbl1', tableName: 'Leads', connectedBy: u, name: 'AT',
      }, adminDb)
      assert.notEqual(created.apiToken, 'plain-token') // encrypted

      assert.equal((await getDataConnection(t, created.id, adminDb))?.id, created.id)
      assert.equal(await getDataConnection(randomUUID(), created.id, adminDb), null) // isolation
      assert.equal((await getDataConnections(t, adminDb)).length, 1)

      await updateDataConnection(t, created.id, { tableName: 'Customers' }, adminDb)
      assert.equal((await getDataConnection(t, created.id, adminDb))?.tableName, 'Customers')

      await updateDataConnectionStatus(t, created.id, 'expired', adminDb)
      assert.equal((await getDataConnection(t, created.id, adminDb))?.status, 'expired')

      await deleteDataConnection(t, created.id, adminDb)
      assert.equal(await getDataConnection(t, created.id, adminDb), null)
    })
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/data && npm test`
Expected: FAIL — Firestore bodies, no `db` param.

- [ ] **Step 3: Rewrite `connections.ts`**

Keep `encryptToken` (local) and the `import { decryptToken } from '@vibesboard/scheduling/connections'`. New imports:

```ts
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { dataConnections } from '@vibesboard/adapter-postgres/schema'
import { rowToDataConnection } from './db.ts'

type Db = PostgresJsDatabase<typeof schema>
```

`createDataConnection` builds a per-provider `values` object (extract a `buildConnectionValues(params)` pure helper that returns the provider-specific column subset, so the `switch` lives in one ≤CCN-15 function and the insert stays trivial):

```ts
function buildConnectionValues(params: CreateDataConnectionParams) {
  switch (params.provider) {
    case 'google_sheets':
      return {
        accessTokenEncrypted: encryptToken(params.accessToken),
        refreshTokenEncrypted: encryptToken(params.refreshToken),
        tokenExpiresAt: new Date(params.tokenExpiresAt),
        email: params.email ?? null,
        spreadsheetId: params.spreadsheetId,
        sheetName: params.sheetName ?? 'Sheet1',
        scopes: params.scopes,
      }
    case 'airtable':
      return {
        apiTokenEncrypted: encryptToken(params.apiToken),
        baseId: params.baseId,
        tableId: params.tableId,
        tableName: params.tableName ?? null,
      }
    case 'custom_webhook':
      return {
        webhookUrl: params.webhookUrl,
        webhookMethod: params.webhookMethod ?? 'POST',
        webhookHeaders: params.webhookHeaders ?? null,
      }
  }
}

export async function createDataConnection(
  params: CreateDataConnectionParams, // the existing discriminated union type
  db: Db = getMigrateDb(),
): Promise<DataConnectionDocument> {
  const [row] = await db
    .insert(dataConnections)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      provider: params.provider,
      name: params.name,
      status: 'active',
      connectedBy: params.connectedBy,
      ...buildConnectionValues(params),
    })
    .returning()
  return rowToDataConnection(row)
}
```
(Name the union type `CreateDataConnectionParams` — alias the existing inline union.) The other four functions (`getDataConnections`, `getDataConnection`, `deleteDataConnection`, `updateDataConnectionStatus`, `updateDataConnection`) follow the calendar pattern from 6a-2 (tenant-scoped `and(eq(tenantId), eq(id))`, `db` param, mapper on read). `updateDataConnection` sets only the provided `updates` keys + `updatedAt: new Date()`.

Rewrite `getValidDataAccessToken` to take a `db` param and persist the refreshed Google Sheets token via Drizzle (mirror 6a-2's `getValidAccessToken`); the `airtable`/`custom_webhook` branches are unchanged.

> CCN note: extracting `buildConnectionValues` keeps both `createDataConnection` and `getValidDataAccessToken` under CCN 15 (the provider `switch` is the only multi-branch construct and lives alone).

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/data && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/connections.ts packages/data/src/__tests__/connections.test.ts
git commit -m "feat(data): migrate data-connection CRUD + token refresh to Postgres"
```

### Task 6c-3: Data action log helper (`logDataAction` → Postgres)

**Files:**
- Create: `packages/data/src/action-logs.ts`
- Test: `packages/data/src/__tests__/action-logs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, dataConnections, dataActionLogs } from '@vibesboard/adapter-postgres/schema'
import { eq } from 'drizzle-orm'
import { recordDataActionLog } from '../action-logs.ts'

describe('recordDataActionLog', () => {
  test('inserts a success log row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u = randomUUID(); const t = randomUUID(); const a = randomUUID(); const c = randomUUID()
      await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
      await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: `acme-${t.slice(0,8)}`, createdBy: u, isPersonal: false })
      await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: 'a' })
      await adminDb.insert(dataConnections).values({ id: c, tenantId: t, provider: 'airtable', name: 'AT', status: 'active', connectedBy: u })

      await recordDataActionLog({
        tenantId: t, agentId: a, connectionId: c, provider: 'airtable',
        action: 'append_row', status: 'success', rowData: { Name: 'Ada' }, externalRef: 'rec1',
      }, adminDb)

      const rows = await adminDb.select().from(dataActionLogs).where(eq(dataActionLogs.agentId, a))
      assert.equal(rows.length, 1)
      assert.equal(rows[0].action, 'append_row')
      assert.deepEqual(rows[0].rowData, { Name: 'Ada' })
    })
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/data && npm test`
Expected: FAIL — `../action-logs.ts` missing.

- [ ] **Step 3: Implement**

```ts
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { dataActionLogs } from '@vibesboard/adapter-postgres/schema'
import type { DataProvider, DataActionType } from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

export interface RecordDataActionLogParams {
  tenantId: string
  agentId: string
  conversationId?: string | null
  connectionId: string
  provider: DataProvider
  action: DataActionType
  status: 'success' | 'failed'
  rowData: Record<string, unknown>
  externalRef?: string
  error?: string
}

export async function recordDataActionLog(
  p: RecordDataActionLogParams,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.insert(dataActionLogs).values({
    id: uuidv7(),
    tenantId: p.tenantId,
    agentId: p.agentId,
    conversationId: p.conversationId ?? null,
    connectionId: p.connectionId,
    provider: p.provider,
    action: p.action,
    status: p.status,
    rowData: p.rowData,
    externalRef: p.externalRef ?? null,
    error: p.error ?? null,
  })
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/data && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data/src/action-logs.ts packages/data/src/__tests__/action-logs.test.ts
git commit -m "feat(data): add Postgres data-action-log helper"
```

### Task 6c-4: Rewire the data tool onto the action-log helper

**Files:**
- Modify: `packages/ai/src/actions/data/tools.ts` (replace the inlined Firestore `logDataAction` with `recordDataActionLog`; connection reads already flip via `getDataConnection`)

- [ ] **Step 1: Replace imports + the local `logDataAction`**

Remove:
```ts
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections, type DataActionLogDocument, ... } from '@vibesboard/contracts'
```
Add:
```ts
import { type DataConnectionDocument, type VibeAgent, type DataActionType } from '@vibesboard/contracts'
import { recordDataActionLog } from '@vibesboard/data/action-logs'
```
Replace the local `logDataAction(ctx, action, status, rowData, externalRef?, error?)` function body to delegate (keep the same signature + the try/catch swallow so a logging failure never blocks the tool response):

```ts
async function logDataAction(
  ctx: DataToolContext,
  action: DataActionType,
  status: 'success' | 'failed',
  rowData: Record<string, any>,
  externalRef?: string,
  error?: string,
): Promise<void> {
  try {
    await recordDataActionLog({
      tenantId: ctx.agent.tenantId!,
      agentId: ctx.agent.id,
      connectionId: ctx.connection.id,
      provider: ctx.connection.provider,
      action,
      status,
      rowData,
      externalRef,
      error,
    })
  } catch {
    console.error('Failed to log data action')
  }
}
```
The `'delete_row'` casts (`as DataActionLogDocument['action']`) become `as DataActionType` or drop entirely (`delete_row` is a valid `DataActionType`).

- [ ] **Step 2: Typecheck**

Run: `cd packages/ai && npm run typecheck`
Expected: clean.

> CCN note: tool `execute` bodies are unchanged in branch count (still try/catch + matched/unmatched). No new function over CCN 15.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/actions/data/tools.ts
git commit -m "feat(ai): rewire data tool onto Postgres action-log helper"
```

### Task 6c-5: Confirm data routes need no change + final gates

The four data routes call `getDataConnections`/`createDataConnection`/`getDataConnection`/`deleteDataConnection`/`updateDataConnection`/`getValidDataAccessToken` by the same names/signatures (optional `db`). No edits expected.

- [ ] **Step 1: Verify no direct Firestore in data routes**

Run: `grep -rn "adminDb\|Collections.data" apps/web/app/api/data/`
Expected: no matches.

- [ ] **Step 2: Typecheck + complexity gate across touched packages**

Run: `cd packages/data && npm run typecheck && cd ../ai && npm run typecheck`
Run: `npm run complexity-analysis`
Expected: clean; ≤12 functions over CCN 15.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore(data): typecheck + complexity gate for phase 6c"
```

**6c staging verification (post-deploy, API/DB-level):**
1. `POST /api/data/connections` with `{ provider: 'airtable', name, apiToken, baseId, tableId }` returns `201`; the row exists in `data_connections` with an **encrypted** `api_token_encrypted` (SQL `SELECT api_token_encrypted` shows ciphertext, not the plaintext token).
2. `GET /api/data/connections` returns `200` listing it; `PATCH .../[id]` updates `tableName`; `DELETE .../[id]` removes the row.
3. `submit_data` via a chat (or call `recordDataActionLog` directly) writes one `data_action_logs` row with `status='success'`; a webhook with a bad URL still returns `400` from `validateWebhookUrl` (unchanged).

---

## Final teardown note (NOT in scope for Phase 6)

Removing `adminDb` data access entirely, the Firestore seed, and `firestore.rules`/indexes for the migrated collections is **Phase 7** per the spec. RISC (`adapter-google/src/risc.ts`) stays on Firebase — out of scope. Do **not** delete the Firestore adapter in Phase 6.

---

## Self-Review

**Spec coverage:**
- (1) Each domain CRUD → Postgres with `db` param + mappers + `withTestDb`: 6a-1/6a-2 (calendar), 6b-1/6b-2 (bookings), 6b-1/6b-4 (enquiries), 6c-1/6c-2 (data), 6c-3 (action logs). ✓
- (2) Preserve token encryption, note column names: pre-flight + mappers keep ciphertext (`access_token_encrypted` etc.), `encryptToken`/`decryptToken` reused, `apiKeyEncrypted→apiKey` bridge documented. ✓
- (3) `disableAgentsForConnection` Drizzle jsonb update + `db` param + test: 6a-3. ✓
- (4) Agent tool hot paths coherent on Postgres (no mid-path split): 6b-3 (appointments), 6b-5 (booking), 6c-4 (data) — connection reads + booking/enquiry/log writes all land in Postgres within the slice. ✓
- (5) `bookingEnquiries` vs `bookings` relationship clarified: bookings = confirmed calendar events (appointment tool, direct mode); booking_enquiries = lead/availability requests with no calendar write (booking tool enquiry mode + the GET route); they are independent tables, no FK between them. ✓
- (6) RISC stays Firebase / teardown deferred: final note. ✓

**Placeholder scan:** No TBD/TODO/"add validation"/"similar to" — every code step shows full code; every command has expected output. ✓

**Type consistency:** `rowToCalendarConnection`/`rowToBooking`/`rowToBookingEnquiry`/`rowToDataConnection` used consistently; `upsertBooking`/`findActiveBookingByAttendee`/`setBookingStatus`/`listBookingsForDay` names match between 6b-2 definition and 6b-3 callers; `recordDataActionLog`/`listEnquiriesForAgent` names match between definition and callers; `db: Db = getMigrateDb()` last-param shape uniform; `bookings.activeNaturalKey` index name matches between schema (6b-0) and `onConflictDoNothing` target (6b-2). ✓
