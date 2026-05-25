# RISC → Better Auth Migration + Firebase Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point Google RISC (Cross-Account Protection) from Firebase Auth to Better Auth + Postgres, add an enforced `disabled` user flag, and delete `firebase-admin`/`adapter-firebase` entirely.

**Architecture:** RISC's token verification + webhook route are unchanged (pure crypto). `handleRiscEvents` is rewritten to resolve the Google `sub` via the Postgres `accounts` table and act on the `sessions`/`users` tables through new `@vibesboard/adapter-better-auth` helpers. Disabled users are blocked at session creation and in the app's `auth()` reader. Then all Firebase admin code is removed.

**Tech Stack:** Better Auth (drizzle adapter, `usePlural`), Drizzle ORM (postgres-js), Postgres 16, `node --test --experimental-strip-types --conditions react-server`, `withTestDb` from `@vibesboard/adapter-postgres/test-utils`.

**Key facts (verified against the codebase):**
- Better Auth stores Google identities in `accounts` with `provider_id = 'google'`, `account_id = <google sub>`; sessions in `sessions` (`user_id`, `token`). Identity ops use `getMigrateDb()` (BYPASSRLS).
- `apps/web/lib/auth.ts` `auth()` calls `betterAuth.api.getSession({ headers })` and returns `{ user: SessionUser } | null`.
- Better Auth config: `packages/adapter-better-auth/src/config.ts`, has `databaseHooks.user.create.after` already; `advanced.database.generateId = uuidv7`.
- Latest migration is `0009`; next is `0010`. Hand-write SQL + register in `drizzle/meta/_journal.json` (do NOT run `db:generate` — it re-emits stale ALTERs).
- Lizard CI budget: keep total functions over CCN 15 unchanged (verify `python3 -m lizard --CCN 15 <files>` on touched files; `??`/`||`/`&&`/`?:` count as branches).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/adapter-postgres/src/schema/users.ts` | add `disabled` column to `users` | 1 |
| `packages/adapter-postgres/drizzle/0010_users_disabled.sql` + `meta/_journal.json` | migration | 1 |
| `packages/adapter-better-auth/src/risc-effects.ts` (new) | `resolveUserIdByGoogleSub`, `revokeUserSessions`, `setUserDisabled` — Drizzle-only, no auth instance | 2 |
| `packages/adapter-better-auth/src/__tests__/risc-effects.test.ts` (new) | withTestDb tests for the 3 helpers | 2 |
| `packages/adapter-better-auth/src/index.ts` | export the new helpers | 2 |
| `packages/adapter-google/src/risc.ts` | rewrite `handleRiscEvents`; remove `resolveFirebaseUid` + adminAuth import | 3 |
| `packages/adapter-google/src/__tests__/risc-events.test.ts` (new) | event→action mapping tests | 3 |
| `packages/adapter-google/package.json` | drop `@vibesboard/adapter-firebase`, add `@vibesboard/adapter-better-auth` | 3 |
| `packages/adapter-better-auth/src/config.ts` | `disabled` additionalField + `session.create.before` block | 4 |
| `apps/web/lib/auth.ts` | treat `disabled` user as unauthenticated | 4 |
| `packages/adapter-firebase/**`, all `firebase-admin` deps, `firestore-types.ts` | delete | 5 |

---

## Task 1: Add the `disabled` column to `users`

**Files:**
- Modify: `packages/adapter-postgres/src/schema/users.ts`
- Create: `packages/adapter-postgres/drizzle/0010_users_disabled.sql`
- Modify: `packages/adapter-postgres/drizzle/meta/_journal.json`
- Test: `packages/adapter-postgres/src/__tests__/rls-coverage.test.ts` (existing — must still pass)

- [ ] **Step 1: Add the column to the schema**

In `packages/adapter-postgres/src/schema/users.ts`, inside the `users` table definition, after `emailVerified`:

```ts
  emailVerified: boolean('email_verified').notNull().default(false),
  disabled: boolean('disabled').notNull().default(false),
```

- [ ] **Step 2: Hand-write the migration**

Create `packages/adapter-postgres/drizzle/0010_users_disabled.sql`:

```sql
ALTER TABLE "users" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;
```

- [ ] **Step 3: Register it in the journal**

In `packages/adapter-postgres/drizzle/meta/_journal.json`, append to the `entries` array (after the `0009` entry — match the existing object shape, bump `idx` to 10):

```json
    {
      "idx": 10,
      "version": "7",
      "when": 1779950000000,
      "tag": "0010_users_disabled",
      "breakpoints": true
    }
```

- [ ] **Step 4: Run the adapter-postgres tests (migration applies + RLS coverage)**

Run: `pnpm --filter @vibesboard/adapter-postgres test`
Expected: PASS (23 tests; `withTestDb` applies 0010 cleanly; `users` already has RLS so the rls-coverage test stays green).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-postgres/src/schema/users.ts packages/adapter-postgres/drizzle/0010_users_disabled.sql packages/adapter-postgres/drizzle/meta/_journal.json
git commit -m "feat(db): add disabled flag to users (migration 0010)"
```

---

## Task 2: Better Auth RISC-effect helpers

**Files:**
- Create: `packages/adapter-better-auth/src/risc-effects.ts`
- Create: `packages/adapter-better-auth/src/__tests__/risc-effects.test.ts`
- Modify: `packages/adapter-better-auth/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/adapter-better-auth/src/__tests__/risc-effects.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'
import {
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
} from '../risc-effects.ts'

async function seedUser(adminDb: any, opts?: { sub?: string; providerId?: string }) {
  const userId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: `u${userId}@a.com`, name: 'U' })
  if (opts?.sub) {
    await adminDb.insert(accounts).values({
      id: randomUUID(),
      userId,
      providerId: opts.providerId ?? 'google',
      accountId: opts.sub,
    })
  }
  return userId
}

describe('risc-effects', () => {
  test('resolveUserIdByGoogleSub finds the user by google account_id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb, { sub: 'google-sub-123' })
      assert.equal(await resolveUserIdByGoogleSub('google-sub-123', adminDb), userId)
      assert.equal(await resolveUserIdByGoogleSub('nope', adminDb), null)
    })
  })

  test('resolveUserIdByGoogleSub also matches legacy google.com provider', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb, { sub: 'legacy-sub', providerId: 'google.com' })
      assert.equal(await resolveUserIdByGoogleSub('legacy-sub', adminDb), userId)
    })
  })

  test('revokeUserSessions deletes only the target user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedUser(adminDb)
      const b = await seedUser(adminDb)
      await adminDb.insert(sessions).values([
        { id: randomUUID(), userId: a, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
        { id: randomUUID(), userId: a, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
        { id: randomUUID(), userId: b, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
      ])
      await revokeUserSessions(a, adminDb)
      const aLeft = await adminDb.select().from(sessions).where(eq(sessions.userId, a))
      const bLeft = await adminDb.select().from(sessions).where(eq(sessions.userId, b))
      assert.equal(aLeft.length, 0)
      assert.equal(bLeft.length, 1)
    })
  })

  test('setUserDisabled toggles the flag', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb)
      await setUserDisabled(userId, true, adminDb)
      let [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      assert.equal(u.disabled, true)
      await setUserDisabled(userId, false, adminDb)
      ;[u] = await adminDb.select().from(users).where(eq(users.id, userId))
      assert.equal(u.disabled, false)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @vibesboard/adapter-better-auth test`
Expected: FAIL — `../risc-effects.ts` does not exist / no such exports.

- [ ] **Step 3: Implement the helpers**

Create `packages/adapter-better-auth/src/risc-effects.ts`:

```ts
import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

// Better Auth stores Google social identities in `accounts` with
// provider_id='google' and account_id=<google sub>. Older rows may use
// 'google.com'; match both.
const GOOGLE_PROVIDER_IDS = ['google', 'google.com']

/** Resolve a Google OAuth subject (`sub`) to our internal user id, or null. */
export async function resolveUserIdByGoogleSub(
  sub: string,
  db: Db = getMigrateDb(),
): Promise<string | null> {
  const rows = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.accountId, sub), inArray(accounts.providerId, GOOGLE_PROVIDER_IDS)))
    .limit(1)
  return rows[0]?.userId ?? null
}

/** Delete all Better Auth sessions for a user (logs them out everywhere). */
export async function revokeUserSessions(
  userId: string,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** Set the user's disabled flag. */
export async function setUserDisabled(
  userId: string,
  disabled: boolean,
  db: Db = getMigrateDb(),
): Promise<void> {
  await db.update(users).set({ disabled, updatedAt: new Date() }).where(eq(users.id, userId))
}
```

- [ ] **Step 4: Export from the package index**

In `packages/adapter-better-auth/src/index.ts`, add:

```ts
export {
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
} from './risc-effects.ts'
```

(If the package relies on the `./*` wildcard export in `package.json`, importers can use `@vibesboard/adapter-better-auth/risc-effects` directly — confirm the `exports` map; add the explicit index re-export regardless.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @vibesboard/adapter-better-auth test`
Expected: PASS (4 new tests + existing).

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-better-auth/src/risc-effects.ts packages/adapter-better-auth/src/__tests__/risc-effects.test.ts packages/adapter-better-auth/src/index.ts
git commit -m "feat(auth): RISC-effect helpers (resolve google sub, revoke sessions, set disabled)"
```

---

## Task 3: Rewrite `handleRiscEvents` onto Better Auth

**Files:**
- Modify: `packages/adapter-google/src/risc.ts` (remove `adminAuth` import + `resolveFirebaseUid`; rewrite `handleRiscEvents`)
- Modify: `packages/adapter-google/package.json` (swap deps)
- Test: `packages/adapter-google/src/__tests__/risc-events.test.ts` (new)

- [ ] **Step 1: Swap the package dependency**

In `packages/adapter-google/package.json`, remove `"@vibesboard/adapter-firebase": "workspace:*"` and add `"@vibesboard/adapter-better-auth": "workspace:*"`. Then add a test script if missing:

```json
    "test": "node --experimental-strip-types --conditions react-server --test 'src/__tests__/**/*.test.ts'"
```

Run `pnpm install` (lockfile updates; commit it in Step 6).

- [ ] **Step 2: Write the failing test**

Create `packages/adapter-google/src/__tests__/risc-events.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'
import { handleRiscEvents, RISC_EVENTS } from '../risc.ts'

async function seed(adminDb: any, sub: string) {
  const userId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: `u${userId}@a.com`, name: 'U' })
  await adminDb.insert(accounts).values({ id: randomUUID(), userId, providerId: 'google', accountId: sub })
  await adminDb.insert(sessions).values({ id: randomUUID(), userId, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) })
  return userId
}
const tok = (event: string, sub: string) => ({
  iss: 'https://accounts.google.com', aud: 'x', iat: 0, jti: randomUUID(),
  events: { [event]: { subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub } } },
})

describe('handleRiscEvents (Better Auth)', () => {
  test('sessions-revoked deletes the user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-1')
      await handleRiscEvents(tok(RISC_EVENTS.SESSIONS_REVOKED, 'sub-1'), adminDb)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      assert.equal(left.length, 0)
    })
  })

  test('account-disabled sets disabled + revokes sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-2')
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_DISABLED, 'sub-2'), adminDb)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      assert.equal(u.disabled, true)
      assert.equal(left.length, 0)
    })
  })

  test('account-enabled clears disabled', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-3')
      await adminDb.update(users).set({ disabled: true }).where(eq(users.id, userId))
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_ENABLED, 'sub-3'), adminDb)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      assert.equal(u.disabled, false)
    })
  })

  test('unknown sub is a no-op (does not throw)', async () => {
    await withTestDb(async ({ adminDb }) => {
      await handleRiscEvents(tok(RISC_EVENTS.SESSIONS_REVOKED, 'no-such-sub'), adminDb)
    })
  })

  test('verification event is a no-op', async () => {
    await withTestDb(async ({ adminDb }) => {
      await handleRiscEvents(tok(RISC_EVENTS.VERIFICATION, 'whatever'), adminDb)
    })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @vibesboard/adapter-google test`
Expected: FAIL — `handleRiscEvents` does not accept a `db` arg / still imports `adminAuth`.

- [ ] **Step 4: Rewrite `risc.ts`**

In `packages/adapter-google/src/risc.ts`:

(a) Replace the import on line 3:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
} from '@vibesboard/adapter-better-auth'

type Db = PostgresJsDatabase<typeof schema>
```

(b) Delete the entire `resolveFirebaseUid` function (lines ~148–162) and its section header comment.

(c) Replace `handleRiscEvents` with:

```ts
export async function handleRiscEvents(
  payload: RiscTokenPayload,
  db: Db = getMigrateDb(),
): Promise<void> {
  for (const [eventType, eventData] of Object.entries(payload.events)) {
    console.log(`[RISC] Processing event: ${eventType}`, {
      jti: payload.jti,
      subject: eventData.subject?.sub,
    })

    if (eventType === RISC_EVENTS.VERIFICATION) {
      console.log('[RISC] Verification event received', { state: eventData.state })
      continue
    }

    const googleSub = eventData.subject?.sub
    if (!googleSub) {
      console.warn('[RISC] Event missing subject sub — skipping')
      continue
    }

    const userId = await resolveUserIdByGoogleSub(googleSub, db)
    if (!userId) {
      console.warn(`[RISC] No user for Google sub ${googleSub} — skipping`)
      continue
    }

    await applyRiscEvent(eventType, eventData, userId, db)
  }
}

// Extracted so handleRiscEvents stays under the CCN budget.
async function applyRiscEvent(
  eventType: string,
  eventData: RiscEventPayload,
  userId: string,
  db: Db,
): Promise<void> {
  switch (eventType) {
    case RISC_EVENTS.SESSIONS_REVOKED:
    case RISC_EVENTS.TOKENS_REVOKED:
    case RISC_EVENTS.TOKEN_REVOKED:
    case RISC_EVENTS.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED:
      await revokeUserSessions(userId, db)
      console.log(`[RISC] Revoked sessions for user ${userId}`)
      break
    case RISC_EVENTS.ACCOUNT_DISABLED:
      await setUserDisabled(userId, true, db)
      await revokeUserSessions(userId, db)
      console.log(`[RISC] Disabled user ${userId} (reason: ${eventData.reason ?? 'unknown'})`)
      break
    case RISC_EVENTS.ACCOUNT_ENABLED:
      await setUserDisabled(userId, false, db)
      console.log(`[RISC] Re-enabled user ${userId}`)
      break
    default:
      console.warn(`[RISC] Unknown event type: ${eventType}`)
  }
}
```

- [ ] **Step 5: Run tests + type-check + lizard**

Run: `pnpm --filter @vibesboard/adapter-google test` → PASS (5 tests).
Run: `pnpm --filter @vibesboard/adapter-google type-check` → clean.
Run: `python3 -m lizard --CCN 15 packages/adapter-google/src/risc.ts` → no function over 15 (the switch is now in `applyRiscEvent`, ~6 cases; `handleRiscEvents` loop is small).
Grep: `grep -nE "adminAuth|firebase" packages/adapter-google/src/risc.ts` → zero.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-google/src/risc.ts packages/adapter-google/src/__tests__/risc-events.test.ts packages/adapter-google/package.json pnpm-lock.yaml
git commit -m "feat(risc): handle Google security events on Better Auth + Postgres"
```

---

## Task 4: Enforce `disabled` in Better Auth

**Files:**
- Modify: `packages/adapter-better-auth/src/config.ts`
- Modify: `apps/web/lib/auth.ts`
- Test: `packages/adapter-better-auth/src/__tests__/disabled-enforcement.test.ts` (new)

- [ ] **Step 1: Write the failing test for the session-create block**

The enforcement logic is a small pure predicate so it's unit-testable without standing up the full auth server. Create `packages/adapter-better-auth/src/__tests__/disabled-enforcement.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users } from '@vibesboard/adapter-postgres/schema'
import { isUserDisabled } from '../risc-effects.ts'

describe('isUserDisabled', () => {
  test('true for a disabled user, false otherwise, false for missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = randomUUID()
      await adminDb.insert(users).values({ id, email: `u${id}@a.com`, name: 'U', disabled: true })
      assert.equal(await isUserDisabled(id, adminDb), true)
      await adminDb.update(users).set({ disabled: false }).where(eq(users.id, id))
      assert.equal(await isUserDisabled(id, adminDb), false)
      assert.equal(await isUserDisabled(randomUUID(), adminDb), false)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @vibesboard/adapter-better-auth test`
Expected: FAIL — `isUserDisabled` not exported.

- [ ] **Step 3: Add `isUserDisabled` to `risc-effects.ts`**

```ts
/** True if the user exists and is disabled. Missing user → false. */
export async function isUserDisabled(
  userId: string,
  db: Db = getMigrateDb(),
): Promise<boolean> {
  const rows = await db
    .select({ disabled: users.disabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return rows[0]?.disabled === true
}
```

Export it from `index.ts` alongside the others.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @vibesboard/adapter-better-auth test` → PASS.

- [ ] **Step 5: Surface `disabled` on the session user + block session creation**

In `packages/adapter-better-auth/src/config.ts`, add a `user.additionalFields` entry so `disabled` rides in the session, and a `session.create.before` hook that aborts for disabled users. Inside `betterAuth({...})`:

```ts
  user: {
    additionalFields: {
      disabled: { type: 'boolean', input: false, defaultValue: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: (user) => onUserCreateAfter(user),
      },
    },
    session: {
      create: {
        before: async (session) => {
          const { isUserDisabled } = await import('./risc-effects.ts')
          if (await isUserDisabled(session.userId)) {
            // Returning false aborts session creation (blocks disabled re-login).
            return false
          }
          return { data: session }
        },
      },
    },
  },
```

(Import lazily inside the hook to avoid a module load cycle between config and risc-effects.)

- [ ] **Step 6: Guard the app `auth()` reader**

In `apps/web/lib/auth.ts`, after fetching the session, treat a disabled user as unauthenticated:

```ts
export async function auth(): Promise<{ user: SessionUser } | null> {
  const session = await betterAuth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  if ((session.user as { disabled?: boolean }).disabled === true) return null
  return { user: session.user as SessionUser }
}
```

(Adjust to the file's exact existing shape — keep its current return/typing; just add the disabled short-circuit. If `SessionUser` doesn't include `disabled`, the cast above avoids widening the public type.)

- [ ] **Step 7: Verify**

Run: `pnpm --filter @vibesboard/adapter-better-auth test` → PASS.
Run: `pnpm --filter @vibesboard/web type-check` → clean.
Run: `pnpm --filter @vibesboard/web build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-better-auth/src/config.ts packages/adapter-better-auth/src/risc-effects.ts packages/adapter-better-auth/src/index.ts packages/adapter-better-auth/src/__tests__/disabled-enforcement.test.ts apps/web/lib/auth.ts
git commit -m "feat(auth): block disabled users at session creation + auth() reader"
```

---

## Task 5: Delete Firebase admin entirely

**Files:**
- Delete: `packages/adapter-firebase/**`
- Modify: every `package.json` that lists `@vibesboard/adapter-firebase` or `firebase-admin`
- Modify: `packages/contracts/src/types.ts` + delete `packages/contracts/src/firestore-types.ts`
- Modify: `apps/web` Firebase admin env/init references (if any remain)

- [ ] **Step 1: Confirm RISC was the last `adapter-firebase` consumer**

Run: `grep -rln "@vibesboard/adapter-firebase\|firebase-admin" packages apps --include=*.ts --include=*.tsx --include=package.json | grep -vE "node_modules|\.next|adapter-firebase/"`
Expected: after Task 3, only `package.json` files listing the dep remain (no `.ts` imports). If any `.ts` import remains, STOP and report — it's an unmigrated consumer.

- [ ] **Step 2: Relocate the two surviving type aliases, then delete `firestore-types.ts`**

`packages/contracts/src/types.ts` imports `AgentMode` and `QuickSuggestionsMode` from `firestore-types.ts`. Move those two type alias definitions into `types.ts` directly, remove the import, and remove the `firestore-types` re-export from `packages/contracts/src/index.ts`. Then:

```bash
git rm packages/contracts/src/firestore-types.ts
```

Run: `pnpm --filter @vibesboard/contracts type-check` → clean.

- [ ] **Step 3: Remove the deps + delete the package**

Remove `"@vibesboard/adapter-firebase": "workspace:*"` from `adapter-google/package.json` (and any other package.json still listing it) and `"firebase-admin": "..."` from every `package.json` that has it (per Step 1's list — e.g. `agents`, `ai`, `policy`). Then:

```bash
git rm -r packages/adapter-firebase
```

- [ ] **Step 4: Remove residual Firebase admin init/env**

Grep for admin-only Firebase config: `grep -rn "FIREBASE_SERVICE_ACCOUNT_KEY\|firebase-admin" apps/web .github Dockerfile* firebase.json 2>/dev/null | grep -v node_modules`. Remove the `FIREBASE_SERVICE_ACCOUNT_KEY` secret wiring from the Cloud Run deploy workflow + Dockerfile if present (it's no longer read). **Do NOT touch** `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (Better Auth Google OAuth) or `storage.rules`. Note: Firebase Storage was already removed in the prior teardown; confirm no `adminStorage` consumer remains.

- [ ] **Step 5: Reinstall + full verify**

```bash
pnpm install
```

Run, expecting all green:
- `pnpm -r test`
- `pnpm -r type-check`
- `pnpm --filter @vibesboard/web build`
- `pnpm lint`

- [ ] **Step 6: Final grep gate**

Run: `grep -rn "firebase-admin\|adapter-firebase\|adminAuth\|getFirestore" packages apps --include=*.ts --include=*.tsx | grep -vE "node_modules|\.next"`
Expected: **zero** matches in production source. The app is now fully Firebase-free.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(teardown): remove firebase-admin + adapter-firebase entirely (app is Firebase-free)"
```

---

## Self-Review

- **Spec coverage:** verifyRiscToken unchanged (noted, Task 3 leaves it) ✓; handleRiscEvents rewrite (Task 3) ✓; resolveUserIdByGoogleSub/revokeUserSessions/setUserDisabled in adapter-better-auth (Task 2) ✓; `disabled` column + migration (Task 1) ✓; enforcement at session.create.before + auth() (Task 4) ✓; firebase-admin/adapter-firebase deletion + firestore-types relocation + final grep gate (Task 5) ✓; legacy `google.com` provider guard (Task 2 resolver + test) ✓.
- **Placeholders:** none — every code step has full code; the `auth.ts` step says "adjust to exact existing shape" but provides the complete edit.
- **Type consistency:** `Db` type, helper signatures (`resolveUserIdByGoogleSub`/`revokeUserSessions`/`setUserDisabled`/`isUserDisabled`) consistent across Tasks 2–4; `RISC_EVENTS`/`RiscTokenPayload`/`RiscEventPayload` reused from the existing file in Task 3.
- **Risk follow-through:** provider_id verified against live data via the legacy-`google.com` guard + test; `FIREBASE_SERVICE_ACCOUNT_KEY` removal gated on Step 1's "last consumer" check.
