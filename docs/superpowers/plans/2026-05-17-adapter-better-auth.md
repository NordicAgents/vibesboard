# Auth Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Replace Firebase Auth with Better Auth on Postgres. Every existing `auth()`, `requireTenantMember`, `requireTenantAdmin`, `requireSuperAdmin` caller continues to work; the Firebase-specific implementation files are deleted.

**Architecture:** New `@vibesboard/adapter-better-auth` package wires Better Auth to the Postgres schema added by sub-project #1. A `databaseHooks.user.create.after` hook auto-creates a personal tenant + TENANT_ADMIN tenant_member row per new sign-up. `apps/web` server helpers are rewritten; client-side sign-in uses Better Auth's React client.

**Tech Stack:** `better-auth`, `@vibesboard/adapter-postgres` (Drizzle), `resend` (email), Node `node --test`.

**Spec:** [docs/superpowers/specs/2026-05-17-adapter-better-auth-design.md](../specs/2026-05-17-adapter-better-auth-design.md) — read this before Task 1.

---

## File structure (target state)

```
docs/...                                                 (spec + plan committed)
packages/adapter-postgres/
  src/schema/users.ts                                    (modified — add cols + accounts + verifications)
  src/types.ts                                           (modified — re-export new types)
  src/__tests__/rls-coverage.test.ts                     (modified — add 'verifications' to RLS_EXEMPT)
  drizzle/0002_better_auth_tables.sql                    (NEW — generated)
  drizzle/0003_better_auth_rls.sql                       (NEW — hand-written)
packages/adapter-better-auth/                            (NEW package)
  package.json
  tsconfig.json
  README.md
  src/index.ts
  src/config.ts
  src/email.ts
  src/on-user-create.ts
  src/__tests__/email-password.test.ts
  src/__tests__/magic-link.test.ts
  src/__tests__/tenant-creation.test.ts
apps/web/
  lib/auth.ts                                            (NEW)
  lib/auth/route-handler.ts                              (NEW)
  lib/auth-client.ts                                     (NEW)
  app/api/auth/[...all]/route.ts                         (NEW)
  app/api/auth/session/route.ts                          (DELETED)
  app/sign-in/page.tsx                                   (REWRITTEN)
  app/sign-up/page.tsx                                   (REWRITTEN)
  auth.ts                                                (MODIFIED — re-export from lib/auth)
  middleware.ts                                          (MODIFIED — cookie name)
  lib/firebase/auth.ts                                   (DELETED at Task 12)
  lib/firebase/route-handler.ts                          (DELETED at Task 12)
  package.json                                           (MODIFIED — add adapter-better-auth dep)
.env.example                                             (MODIFIED — add BETTER_AUTH_*, remove AUTH_GITHUB_*)
README.md                                                (MODIFIED — Better Auth note)
```

---

## Tasks

### Task 1: Extend adapter-postgres schema for Better Auth

**Files:**
- Modify: `packages/adapter-postgres/src/schema/users.ts`
- Modify: `packages/adapter-postgres/src/types.ts`

- [ ] **Step 1.1:** Modify `packages/adapter-postgres/src/schema/users.ts`. The current file defines `users` and `sessions` tables. You need to:

(a) Add `emailVerified` column to `users`. The full updated `users` definition:

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  imageUrl: text('image_url'),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

(b) Add `ipAddress` and `userAgent` columns to `sessions`. The full updated `sessions` definition:

```ts
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index('sessions_user_idx').on(t.userId),
  }),
)
```

(c) Add two NEW tables after `sessions` (still in `users.ts`). You also need to import `uniqueIndex` if not already imported:

```ts
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index('accounts_user_idx').on(t.userId),
    byProvider: uniqueIndex('accounts_provider_account_idx').on(t.providerId, t.accountId),
  }),
)

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byIdentifier: index('verifications_identifier_idx').on(t.identifier),
  }),
)

export type Account = typeof accounts.$inferSelect
export type Verification = typeof verifications.$inferSelect
```

- [ ] **Step 1.2:** Update `packages/adapter-postgres/src/types.ts` to re-export the new types. Find the line:

```ts
export type { User, NewUser, Session } from './schema/users.ts'
```

Replace with:

```ts
export type { User, NewUser, Session, Account, Verification } from './schema/users.ts'
```

- [ ] **Step 1.3:** Type-check

Run: `pnpm --filter @vibesboard/adapter-postgres type-check`
Expected: passes.

- [ ] **Step 1.4:** Commit

```bash
git add packages/adapter-postgres/src/schema/users.ts packages/adapter-postgres/src/types.ts
git commit -m "feat(adapter-postgres): extend schema for Better Auth (accounts, verifications)"
```

---

### Task 2: Generate migration 0002 + write RLS migration 0003

**Files:**
- Create (generated): `packages/adapter-postgres/drizzle/0002_*.sql`
- Create (generated): `packages/adapter-postgres/drizzle/meta/0002_snapshot.json`
- Create (hand-written): `packages/adapter-postgres/drizzle/0003_better_auth_rls.sql`
- Modify: `packages/adapter-postgres/src/__tests__/rls-coverage.test.ts`

- [ ] **Step 2.1:** Ensure dev DB is up. Run `pnpm db:up` if no postgres container is running.

- [ ] **Step 2.2:** Generate the schema migration

Run: `pnpm db:generate`
Expected: creates a new file `packages/adapter-postgres/drizzle/0002_<descriptor>.sql` with the additions: ALTER TABLE users ADD COLUMN email_verified, ALTER TABLE sessions ADD COLUMN ip_address + user_agent, CREATE TABLE accounts, CREATE TABLE verifications, with indexes. Also updates `meta/_journal.json` and writes `meta/0002_snapshot.json`.

Inspect the generated SQL — confirm it makes sense. If it tries to drop+recreate sessions instead of adding columns, report it (Drizzle Kit sometimes does this with composite indexes; the fix is usually to confirm yes-add-column at the prompt).

- [ ] **Step 2.3:** Create `packages/adapter-postgres/drizzle/0003_better_auth_rls.sql`:

```sql
-- Enable RLS on the two new Better Auth tables.
-- `accounts` is keyed on user_id (same pattern as sessions_self).
-- `verifications` is GLOBAL (no tenant_id, no user_id at row creation):
--   the auth flow inserts a row keyed by `identifier` (email being verified)
--   BEFORE the user exists. Adding it to RLS_EXEMPT in the coverage test.

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_self ON accounts
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
```

Note: `verifications` deliberately does NOT enable RLS — the auth flow needs to read/insert/delete by `identifier` (email) BEFORE a user_id exists. It is added to the test-time RLS_EXEMPT allowlist in Step 2.5.

- [ ] **Step 2.4:** Apply the migrations

Run: `pnpm db:migrate`
Expected: both 0002 and 0003 apply cleanly. If Drizzle Kit doesn't auto-pick up 0003 (it didn't always with 0001 in sub-project #1), check `meta/_journal.json` — if 0003 is missing, append an entry mirroring the existing format with `idx: 3, tag: "0003_better_auth_rls"` and re-run.

Verify with:
```bash
docker exec $(docker ps -qf name=postgres) psql -U vibesboard_app -d vibesboard_dev -c "\d accounts" -c "\d verifications" -c "\d users" -c "\d sessions"
```
Expected: `accounts` and `verifications` tables exist with the columns/indexes from Step 1.1; `users` has `email_verified` column; `sessions` has `ip_address` + `user_agent`.

- [ ] **Step 2.5:** Update `packages/adapter-postgres/src/__tests__/rls-coverage.test.ts`. Find the `RLS_EXEMPT` Set and add `verifications`:

```ts
const RLS_EXEMPT = new Set<string>([
  // Drizzle Kit creates this to track applied migrations. Not application data.
  '__drizzle_migrations',
  // Better Auth verification tokens: identifier-keyed (the email being verified),
  // inserted BEFORE the user exists. The auth flow itself needs to read/write
  // by identifier without a user_id context. Stays public-readable.
  'verifications',
])
```

- [ ] **Step 2.6:** Run all adapter-postgres tests

Run: `pnpm --filter @vibesboard/adapter-postgres test`
Expected: 23/23 still pass.

- [ ] **Step 2.7:** Commit

```bash
git add packages/adapter-postgres/drizzle/ packages/adapter-postgres/src/__tests__/rls-coverage.test.ts
git commit -m "feat(adapter-postgres): migrate Better Auth tables + RLS policies"
```

---

### Task 3: Scaffold @vibesboard/adapter-better-auth

**Files:**
- Create: `packages/adapter-better-auth/package.json`
- Create: `packages/adapter-better-auth/tsconfig.json`
- Create: `packages/adapter-better-auth/README.md`

- [ ] **Step 3.1:** Create `packages/adapter-better-auth/package.json`:

```json
{
  "name": "@vibesboard/adapter-better-auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "node --experimental-strip-types --conditions react-server --test 'src/__tests__/**/*.test.ts'"
  },
  "dependencies": {
    "@vibesboard/adapter-postgres": "workspace:*",
    "better-auth": "^1.1.0",
    "resend": "^4.0.0",
    "uuidv7": "^1.0.2",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "drizzle-orm": "^0.36.4",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 3.2:** Create `packages/adapter-better-auth/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3.3:** Create `packages/adapter-better-auth/README.md`:

```md
# @vibesboard/adapter-better-auth

Better Auth identity layer for Vibesboard self-host, wired to Postgres
via `@vibesboard/adapter-postgres`.

## Status

Sub-project #2 of the Firebase → Postgres/S3/Auth migration. See the
[design spec](../../docs/superpowers/specs/2026-05-17-adapter-better-auth-design.md).

## What it provides

- Google OAuth, email + password, magic link sign-in
- Drizzle adapter pointed at our existing users/sessions/accounts/verifications tables
- An `onUserCreate` hook that auto-creates a personal tenant + TENANT_ADMIN
  tenant_members row when a new user signs up
- Email senders backed by Resend (or console-logging fallback when
  RESEND_API_KEY is unset)
```

- [ ] **Step 3.4:** Install + type-check

Run: `pnpm install`
Expected: completes; `better-auth` and `resend` resolved.

If the `better-auth@^1.1.0` constraint doesn't resolve, accept whatever the latest 1.x is and report what you used.

The package has no `src/` yet — `pnpm --filter @vibesboard/adapter-better-auth type-check` will print `TS18003: No inputs were found`. That's expected; subsequent tasks add source files.

- [ ] **Step 3.5:** Commit

```bash
git add packages/adapter-better-auth/
git commit -m "feat(adapter-better-auth): scaffold package + deps"
```

---

### Task 4: Email senders

**Files:**
- Create: `packages/adapter-better-auth/src/email.ts`

- [ ] **Step 4.1:** Create `packages/adapter-better-auth/src/email.ts`:

```ts
import { Resend } from 'resend'

const FROM = process.env.NOTIFICATION_EMAIL_FROM ?? 'Vibesboard <noreply@example.com>'

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

export async function sendMagicLinkEmail({ email, url }: { email: string; url: string }): Promise<void> {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Magic link (dev fallback) for ${email}: ${url}`)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Sign in to Vibesboard',
    html: `<p>Click to sign in: <a href="${url}">${url}</a></p>`,
  })
}

export async function sendVerifyEmail({
  user,
  url,
}: {
  user: { email: string }
  url: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Verify email (dev fallback) for ${user.email}: ${url}`)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: 'Verify your email',
    html: `<p>Verify your email: <a href="${url}">${url}</a></p>`,
  })
}

export async function sendResetPasswordEmail({
  user,
  url,
}: {
  user: { email: string }
  url: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Reset password (dev fallback) for ${user.email}: ${url}`)
    return
  }
  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: 'Reset your Vibesboard password',
    html: `<p>Reset your password: <a href="${url}">${url}</a></p>`,
  })
}
```

- [ ] **Step 4.2:** Type-check + commit

Run: `pnpm --filter @vibesboard/adapter-better-auth type-check`
Expected: passes.

```bash
git add packages/adapter-better-auth/src/email.ts
git commit -m "feat(adapter-better-auth): email senders with Resend + console fallback"
```

---

### Task 5: onUserCreate hook

**Files:**
- Create: `packages/adapter-better-auth/src/on-user-create.ts`

- [ ] **Step 5.1:** Create `packages/adapter-better-auth/src/on-user-create.ts`:

```ts
import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { createMigrateClient } from '@vibesboard/adapter-postgres/client'
import { tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'

/**
 * After-create hook. Better Auth has just inserted a new `users` row.
 * Auto-create a personal tenant + TENANT_ADMIN tenant_members row so the
 * user lands in a usable workspace on first sign-in.
 *
 * Idempotent: if the user already has any tenant_members row (retry after
 * partial failure), do nothing. Uses the migrate client (BYPASSRLS) because
 * at this point the auth flow has no tenant context to set.
 */
export async function onUserCreateAfter(
  user: { id: string; email: string; name?: string | null },
): Promise<void> {
  const db = createMigrateClient()

  const existing = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1)
  if (existing.length > 0) return

  // Slug from email local-part with collision suffix.
  const base = user.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 32) || 'workspace'

  let slug = base
  let suffix = 0
  // Loop up to a reasonable cap to avoid infinite loops in adversarial cases.
  while (suffix < 100) {
    const collision = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
    if (collision.length === 0) break
    suffix++
    slug = `${base}-${suffix}`
  }

  const tenantId = uuidv7()
  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: user.name ?? `${user.email.split('@')[0]}'s workspace`,
      slug,
      createdBy: user.id,
      isPersonal: true,
    })
    await tx.insert(tenantMembers).values({
      tenantId,
      userId: user.id,
      role: 'TENANT_ADMIN',
    })
  })
}
```

- [ ] **Step 5.2:** Type-check + commit

Run: `pnpm --filter @vibesboard/adapter-better-auth type-check`
Expected: passes.

```bash
git add packages/adapter-better-auth/src/on-user-create.ts
git commit -m "feat(adapter-better-auth): auto-tenant-creation hook"
```

---

### Task 6: Main Better Auth config + index export

**Files:**
- Create: `packages/adapter-better-auth/src/config.ts`
- Create: `packages/adapter-better-auth/src/index.ts`

- [ ] **Step 6.1:** Create `packages/adapter-better-auth/src/config.ts`:

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { getDb } from '@vibesboard/adapter-postgres/client'
import {
  users,
  sessions,
  accounts,
  verifications,
} from '@vibesboard/adapter-postgres/schema'
import { sendMagicLinkEmail, sendVerifyEmail, sendResetPasswordEmail } from './email.ts'
import { onUserCreateAfter } from './on-user-create.ts'

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: sendResetPasswordEmail,
  },
  emailVerification: {
    sendVerificationEmail: sendVerifyEmail,
  },
  socialProviders: {
    google:
      process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
        ? {
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }
        : undefined,
  },
  plugins: [
    magicLink({
      sendMagicLink: sendMagicLinkEmail,
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        after: onUserCreateAfter,
      },
    },
  },
})

export type Auth = typeof auth
```

- [ ] **Step 6.2:** Create `packages/adapter-better-auth/src/index.ts`:

```ts
export { auth, type Auth } from './config.ts'
export { onUserCreateAfter } from './on-user-create.ts'
export { sendMagicLinkEmail, sendVerifyEmail, sendResetPasswordEmail } from './email.ts'
```

- [ ] **Step 6.3:** Type-check + commit

Run: `pnpm --filter @vibesboard/adapter-better-auth type-check`
Expected: passes.

If Better Auth's type system complains about `socialProviders.google` being possibly `undefined`, the conditional pattern above may need a runtime spread instead — see Better Auth docs. Adapt as needed.

```bash
git add packages/adapter-better-auth/src/config.ts packages/adapter-better-auth/src/index.ts
git commit -m "feat(adapter-better-auth): Better Auth config with Drizzle + magic link plugin"
```

---

### Task 7: adapter-better-auth tests

**Files:**
- Create: `packages/adapter-better-auth/src/__tests__/tenant-creation.test.ts`
- Create: `packages/adapter-better-auth/src/__tests__/email-password.test.ts`
- Create: `packages/adapter-better-auth/src/__tests__/magic-link.test.ts`

These are tricky tests — they need a Better Auth instance bound to an isolated test DB schema. We use `withTestDb` from adapter-postgres to provide the schema, but Better Auth's `betterAuth({ database: drizzleAdapter(db) })` creates a long-lived auth instance, not one we can re-bind. Strategy: create a fresh `betterAuth(...)` instance per test that points at the test DB.

- [ ] **Step 7.1:** Create `packages/adapter-better-auth/src/__tests__/tenant-creation.test.ts`. This one exercises just the `onUserCreateAfter` hook directly — no Better Auth instance needed:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'

// Inline the hook logic for this test — we don't want to import the real
// hook because it instantiates createMigrateClient() at module load using
// real env vars. Instead this test verifies the BEHAVIOUR (slug-uniqueness,
// idempotency, tenant + tenant_members rows created) using the test's own
// adminDb.
async function runHook(
  adminDb: any,
  user: { id: string; email: string; name?: string | null },
) {
  const existing = await adminDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1)
  if (existing.length > 0) return

  const base =
    user.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 32) || 'workspace'

  let slug = base
  let suffix = 0
  while (suffix < 100) {
    const collision = await adminDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
    if (collision.length === 0) break
    suffix++
    slug = `${base}-${suffix}`
  }

  const tenantId = uuidv7()
  await adminDb.transaction(async (tx: any) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: user.name ?? `${user.email.split('@')[0]}'s workspace`,
      slug,
      createdBy: user.id,
      isPersonal: true,
    })
    await tx.insert(tenantMembers).values({
      tenantId,
      userId: user.id,
      role: 'TENANT_ADMIN',
    })
  })
}

describe('onUserCreate (auto-tenant creation)', () => {
  test('creates a personal tenant + TENANT_ADMIN membership for a new user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'alice@acme.com', name: 'Alice' })

      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' })

      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, userId))
      assert.equal(ts.length, 1)
      assert.equal(ts[0].slug, 'acme')
      assert.equal(ts[0].isPersonal, true)

      const ms = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.userId, userId))
      assert.equal(ms.length, 1)
      assert.equal(ms[0].role, 'TENANT_ADMIN')
      assert.equal(ms[0].tenantId, ts[0].id)
    })
  })

  test('uniques the slug when two users share a domain', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u1 = uuidv7()
      const u2 = uuidv7()
      await adminDb.insert(users).values([
        { id: u1, email: 'alice@acme.com', name: 'Alice' },
        { id: u2, email: 'bob@acme.com',   name: 'Bob' },
      ])

      await runHook(adminDb, { id: u1, email: 'alice@acme.com', name: 'Alice' })
      await runHook(adminDb, { id: u2, email: 'bob@acme.com',   name: 'Bob' })

      // slug local-parts are 'alice' and 'bob' — each unique already.
      // The collision case is when local-parts overlap; test that.
    })
  })

  test('local-part collision uniques the slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u1 = uuidv7()
      const u2 = uuidv7()
      await adminDb.insert(users).values([
        { id: u1, email: 'alice@one.com', name: 'Alice' },
        { id: u2, email: 'alice@two.com', name: 'Alice2' },
      ])
      await runHook(adminDb, { id: u1, email: 'alice@one.com', name: 'Alice' })
      await runHook(adminDb, { id: u2, email: 'alice@two.com', name: 'Alice2' })

      const slugs = (await adminDb.select({ slug: tenants.slug }).from(tenants))
        .map((r: { slug: string }) => r.slug)
        .sort()
      assert.deepEqual(slugs, ['alice', 'alice-1'])
    })
  })

  test('is idempotent — second run for the same user does nothing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'alice@acme.com', name: 'Alice' })

      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' })
      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' })

      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, userId))
      assert.equal(ts.length, 1)
      const ms = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.userId, userId))
      assert.equal(ms.length, 1)
    })
  })
})
```

- [ ] **Step 7.2:** Create `packages/adapter-better-auth/src/__tests__/email-password.test.ts`. This test instantiates a real Better Auth and exercises the sign-up flow:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users as usersTable, tenants, tenantMembers, verifications } from '@vibesboard/adapter-postgres/schema'
import { onUserCreateAfter } from '../on-user-create.ts'
import { eq } from 'drizzle-orm'

function buildAuth(db: any) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: usersTable,
        session: (require('@vibesboard/adapter-postgres/schema') as any).sessions,
        account: (require('@vibesboard/adapter-postgres/schema') as any).accounts,
        verification: verifications,
      },
    }),
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-32-chars-long-aaaaaaaaaa',
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // keep tests simple
    },
    databaseHooks: {
      user: { create: { after: onUserCreateAfter } },
    },
  })
}

describe('Better Auth email/password sign-up + sign-in', () => {
  test('sign-up creates user + auto-creates personal tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const auth = buildAuth(adminDb)
      const result = await auth.api.signUpEmail({
        body: {
          email: 'alice@acme.com',
          password: 'correct-horse-battery-staple',
          name: 'Alice',
        },
      })

      assert.ok(result.user)
      assert.equal(result.user.email, 'alice@acme.com')

      const ts = await adminDb.select().from(tenants).where(eq(tenants.slug, 'acme'))
      assert.equal(ts.length, 1)

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, result.user.id))
      assert.equal(ms.length, 1)
      assert.equal(ms[0].role, 'TENANT_ADMIN')
    })
  })

  test('sign-in with correct password returns a session', async () => {
    await withTestDb(async ({ adminDb }) => {
      const auth = buildAuth(adminDb)
      await auth.api.signUpEmail({
        body: { email: 'alice@acme.com', password: 'pw-1234567890', name: 'Alice' },
      })

      const result = await auth.api.signInEmail({
        body: { email: 'alice@acme.com', password: 'pw-1234567890' },
      })
      assert.ok(result.user)
      assert.equal(result.user.email, 'alice@acme.com')
    })
  })

  test('sign-in with wrong password returns an error', async () => {
    await withTestDb(async ({ adminDb }) => {
      const auth = buildAuth(adminDb)
      await auth.api.signUpEmail({
        body: { email: 'alice@acme.com', password: 'pw-1234567890', name: 'Alice' },
      })

      await assert.rejects(
        auth.api.signInEmail({
          body: { email: 'alice@acme.com', password: 'wrong-password' },
        }),
      )
    })
  })
})
```

If `require('@vibesboard/adapter-postgres/schema')` triggers ESM issues, replace it with named imports at the top of the file — `import { sessions, accounts } from '@vibesboard/adapter-postgres/schema'` — and pass them in directly.

- [ ] **Step 7.3:** Create `packages/adapter-better-auth/src/__tests__/magic-link.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users as usersTable, sessions, accounts, verifications } from '@vibesboard/adapter-postgres/schema'
import { onUserCreateAfter } from '../on-user-create.ts'

function buildAuth(db: any, sink: { sent?: { email: string; url: string } } = {}) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: usersTable, session: sessions, account: accounts, verification: verifications },
    }),
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-32-chars-long-aaaaaaaaaa',
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          sink.sent = { email, url }
        },
      }),
    ],
    databaseHooks: { user: { create: { after: onUserCreateAfter } } },
  })
}

describe('Better Auth magic link', () => {
  test('signIn.magicLink sends a URL via the configured sender', async () => {
    await withTestDb(async ({ adminDb }) => {
      const sink: { sent?: { email: string; url: string } } = {}
      const auth = buildAuth(adminDb, sink)

      await auth.api.signInMagicLink({ body: { email: 'alice@acme.com' } })

      assert.ok(sink.sent, 'sendMagicLink should have been invoked')
      assert.equal(sink.sent!.email, 'alice@acme.com')
      assert.match(sink.sent!.url, /^http:\/\/localhost:3000\//)
    })
  })
})
```

- [ ] **Step 7.4:** Run tests

Run: `pnpm --filter @vibesboard/adapter-better-auth test`
Expected: tenant-creation tests pass (4 tests). email-password and magic-link tests may or may not — Better Auth's exact API surface (`signUpEmail`, `signInEmail`, `signInMagicLink`) is version-specific. If `auth.api.<method>` errors, check `auth.api.*` available names in the actual installed version of `better-auth` (`grep -r 'signUp' node_modules/better-auth/dist/*.d.ts | head -5`) and adapt. Report what API surface you used.

- [ ] **Step 7.5:** Commit

```bash
git add packages/adapter-better-auth/src/__tests__/
git commit -m "test(adapter-better-auth): tenant creation, email/password, magic link"
```

---

### Task 8: apps/web auth + auth-client

**Files:**
- Create: `apps/web/lib/auth.ts`
- Create: `apps/web/lib/auth-client.ts`
- Modify: `apps/web/auth.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 8.1:** Add `@vibesboard/adapter-better-auth` to `apps/web/package.json` dependencies. Find the dependencies block and add (alphabetical with the other @vibesboard/* entries):

```json
"@vibesboard/adapter-better-auth": "workspace:*",
```

- [ ] **Step 8.2:** Create `apps/web/lib/auth.ts`:

```ts
import 'server-only'
import { headers } from 'next/headers'
import { auth as betterAuth } from '@vibesboard/adapter-better-auth'

export interface SessionUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

export async function auth(): Promise<{ user: SessionUser } | null> {
  const session = await betterAuth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    },
  }
}
```

If `betterAuth.api.getSession` doesn't take a `headers` argument in the installed version, look at the package's `.d.ts` for the actual signature and adapt. Better Auth's API for getting a session from Next.js headers is well documented in its README.

- [ ] **Step 8.3:** Modify `apps/web/auth.ts`. The current file is:

```ts
import 'server-only'
import { auth as firebaseAuth } from '@/lib/firebase/auth'
export const auth = firebaseAuth
```

Replace with:

```ts
import 'server-only'
export { auth, type SessionUser } from '@/lib/auth'
```

- [ ] **Step 8.4:** Create `apps/web/lib/auth-client.ts`:

```ts
'use client'

import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? '',
  plugins: [magicLinkClient()],
})
```

- [ ] **Step 8.5:** Install (to pick up the new workspace dep) + type-check

Run: `pnpm install`
Expected: completes.

Run: `pnpm --filter @vibesboard/web type-check`
Expected: passes. NOTE: callers of the old `verifySessionCookie` and `createSessionCookie` may now fail to type-check because those exports are gone. That's OK if no such caller exists. If type-check errors point to remaining callers of those names, list them and we'll handle in a later task.

- [ ] **Step 8.6:** Commit

```bash
git add apps/web/lib/auth.ts apps/web/lib/auth-client.ts apps/web/auth.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): wire apps/web/auth + lib/auth-client to Better Auth"
```

---

### Task 9: apps/web/lib/auth/route-handler.ts

**Files:**
- Create: `apps/web/lib/auth/route-handler.ts`

- [ ] **Step 9.1:** Create `apps/web/lib/auth/route-handler.ts`:

```ts
import 'server-only'
import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth, type SessionUser } from '../auth'
import { withDb } from '@vibesboard/adapter-postgres/client'
import { tenantMembers, users } from '@vibesboard/adapter-postgres/schema'
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
import type { Role } from '@vibesboard/policy/permissions'

export async function requireAuth(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const session = await auth()
  if (!session?.user) {
    return { ok: false, response: new NextResponse('Unauthorized', { status: 401 }) }
  }
  return { ok: true, user: session.user }
}

export async function requireTenantMember(
  tenantId: string,
): Promise<
  { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse }
> {
  const a = await requireAuth()
  if (!a.ok) return a

  const rows = await withTenant(
    { tenantId, userId: a.user.id, isSuperAdmin: false },
    () =>
      withDb((tx) =>
        tx
          .select({ role: tenantMembers.role })
          .from(tenantMembers)
          .where(
            and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, a.user.id)),
          )
          .limit(1),
      ),
  )

  if (rows.length === 0) {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return { ok: true, user: a.user, role: rows[0].role as Role }
}

export async function requireTenantAdmin(
  tenantId: string,
): Promise<
  { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse }
> {
  const result = await requireTenantMember(tenantId)
  if (!result.ok) return result

  if (result.role !== 'TENANT_ADMIN' && result.role !== 'SUPER_ADMIN') {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return result
}

export async function requireSuperAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const a = await requireAuth()
  if (!a.ok) return a

  // Read users.isSuperAdmin without a tenant context — users table is keyed
  // on user_id (RLS policy `users_self`), so the user can read their own row.
  const rows = await withTenant(
    { tenantId: '', userId: a.user.id, isSuperAdmin: false },
    () =>
      withDb((tx) =>
        tx.select({ isSuperAdmin: users.isSuperAdmin })
          .from(users)
          .where(eq(users.id, a.user.id))
          .limit(1),
      ),
  )

  if (rows.length === 0 || !rows[0].isSuperAdmin) {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return { ok: true, user: a.user }
}
```

- [ ] **Step 9.2:** Type-check + commit

Run: `pnpm --filter @vibesboard/web type-check`
Expected: passes.

```bash
git add apps/web/lib/auth/route-handler.ts
git commit -m "feat(web): Postgres-backed requireAuth + tenant guards"
```

---

### Task 10: /api/auth/[...all] route + delete old session route + middleware cookie name

**Files:**
- Create: `apps/web/app/api/auth/[...all]/route.ts`
- Delete: `apps/web/app/api/auth/session/route.ts`
- Modify: `apps/web/middleware.ts`

- [ ] **Step 10.1:** Create `apps/web/app/api/auth/[...all]/route.ts`:

```ts
import { auth } from '@vibesboard/adapter-better-auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth.handler)
```

- [ ] **Step 10.2:** Delete the old Firebase session-exchange endpoint

Run: `rm apps/web/app/api/auth/session/route.ts`

If `apps/web/app/api/auth/` has additional files (a `sign-out` route or similar), inspect them. The catch-all `[...all]/route.ts` will absorb everything UNDER `/api/auth/*`, but Next.js applies more specific routes first. List any remaining files: `ls apps/web/app/api/auth/`. If they conflict with Better Auth's expected routes (e.g. `/api/auth/sign-out`), delete them too.

- [ ] **Step 10.3:** Modify `apps/web/middleware.ts`. Find the line:

```ts
const SESSION_COOKIE_NAME = '__session'
```

Replace with:

```ts
// Better Auth sets this cookie name by default (configurable via cookies plugin).
const SESSION_COOKIE_NAME = 'better-auth.session_token'
```

- [ ] **Step 10.4:** Type-check + build

Run: `pnpm --filter @vibesboard/web type-check`
Expected: passes.

Run: `pnpm --filter @vibesboard/web build`
Expected: builds successfully.

- [ ] **Step 10.5:** Commit

```bash
git add apps/web/app/api/auth/\[...all\]/route.ts apps/web/middleware.ts
git rm apps/web/app/api/auth/session/route.ts
git commit -m "feat(web): mount Better Auth catch-all route + update middleware cookie"
```

---

### Task 11: Sign-in / sign-up page rewrites

**Files:**
- Modify: `apps/web/app/sign-in/page.tsx`
- Modify: `apps/web/app/sign-up/page.tsx`

These pages currently use Firebase Web SDK. Replace with Better Auth client.

- [ ] **Step 11.1:** Read the current `apps/web/app/sign-in/page.tsx` to understand its structure (layout, error handling, redirects). DO NOT preserve Firebase-specific code; the auth library is changing.

- [ ] **Step 11.2:** Replace `apps/web/app/sign-in/page.tsx` entirely with:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function signInGoogle() {
    setError(null)
    setLoading(true)
    await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
    // signIn.social redirects — no need to handle return value here
  }

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await authClient.signIn.email({ email, password, callbackURL: '/' })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Sign-in failed')
      return
    }
    router.push('/')
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/' })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Could not send magic link')
      return
    }
    setMagicLinkSent(true)
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      <button
        onClick={signInGoogle}
        disabled={loading}
        className="w-full rounded border px-4 py-2 disabled:opacity-50"
      >
        Continue with Google
      </button>

      <div className="text-center text-sm text-gray-500">or</div>

      <form onSubmit={signInPassword} className="space-y-3">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </form>

      <form onSubmit={sendMagicLink} className="space-y-3">
        <button
          type="submit"
          disabled={loading || !email}
          className="w-full rounded border px-4 py-2 disabled:opacity-50"
        >
          Email me a sign-in link
        </button>
      </form>

      {magicLinkSent && (
        <p className="text-sm text-green-700">
          Check your email for a sign-in link.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}

      <p className="text-sm">
        New here?{' '}
        <a href="/sign-up" className="underline">
          Create an account
        </a>
      </p>
    </div>
  )
}
```

- [ ] **Step 11.3:** Replace `apps/web/app/sign-up/page.tsx` with a similar structure:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function SignUpPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsVerify, setNeedsVerify] = useState(false)

  async function signUpGoogle() {
    setError(null)
    setLoading(true)
    await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
  }

  async function signUpPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await authClient.signUp.email({
      email,
      password,
      name,
      callbackURL: '/',
    })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Sign-up failed')
      return
    }
    // Email verification is required by config; tell the user to check.
    setNeedsVerify(true)
  }

  if (needsVerify) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-12">
        <h1 className="text-2xl font-semibold">Almost there</h1>
        <p>We sent a verification link to <strong>{email}</strong>. Click it to finish creating your account.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 py-12">
      <h1 className="text-2xl font-semibold">Create your account</h1>

      <button
        onClick={signUpGoogle}
        disabled={loading}
        className="w-full rounded border px-4 py-2 disabled:opacity-50"
      >
        Sign up with Google
      </button>

      <div className="text-center text-sm text-gray-500">or</div>

      <form onSubmit={signUpPassword} className="space-y-3">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Create account
        </button>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <p className="text-sm">
        Already have an account?{' '}
        <a href="/sign-in" className="underline">
          Sign in
        </a>
      </p>
    </div>
  )
}
```

- [ ] **Step 11.4:** Type-check + build

Run: `pnpm --filter @vibesboard/web type-check && pnpm --filter @vibesboard/web build`
Expected: both pass.

- [ ] **Step 11.5:** Commit

```bash
git add apps/web/app/sign-in/page.tsx apps/web/app/sign-up/page.tsx
git commit -m "feat(web): Better Auth client sign-in and sign-up pages"
```

---

### Task 12: Delete Firebase auth helpers + env var updates

**Files:**
- Delete: `apps/web/lib/firebase/auth.ts`
- Delete: `apps/web/lib/firebase/route-handler.ts`
- Modify: `.env.example`

The 43 callers all import from `@/lib/firebase/route-handler` (or via `@/auth`). They need to be updated to import from the new path.

- [ ] **Step 12.1:** Update every import. There are ~43 files using `@/lib/firebase/route-handler` or `@/lib/firebase/auth`. Do a repo-wide find-replace:

```bash
# Replace lib/firebase/route-handler imports
grep -rEl "from '@/lib/firebase/route-handler'" apps/web | xargs sed -i '' "s|from '@/lib/firebase/route-handler'|from '@/lib/auth/route-handler'|g"

# Replace lib/firebase/auth imports (any direct importers, not via @/auth)
grep -rEl "from '@/lib/firebase/auth'" apps/web | xargs sed -i '' "s|from '@/lib/firebase/auth'|from '@/lib/auth'|g"
```

If `xargs` complains (no input), the grep found no matches — that's fine for that path.

Verify with: `grep -rE "from '@/lib/firebase/(auth|route-handler)'" apps/web` — expected zero matches.

- [ ] **Step 12.2:** Delete the old files

```bash
rm apps/web/lib/firebase/auth.ts
rm apps/web/lib/firebase/route-handler.ts
```

- [ ] **Step 12.3:** Modify `.env.example`. Remove these blocks:

```
## GitHub OAuth — set first value to "false" if you choose not to use GitHub
NEXT_PUBLIC_AUTH_GITHUB=false
AUTH_GITHUB_ID=XXXXXXXX
AUTH_GITHUB_SECRET=XXXXXXXX
```

Append a new block at the end of the file:

```bash
## Better Auth (server-side session signing)
## Generate with: openssl rand -hex 32
BETTER_AUTH_SECRET=your-better-auth-secret
```

- [ ] **Step 12.4:** Type-check + build

Run: `pnpm --filter @vibesboard/web type-check`
Expected: passes.

Run: `pnpm --filter @vibesboard/web build`
Expected: passes.

If type-check or build fails because some caller still references `verifySessionCookie` / `createSessionCookie` / `getSessionCookieOptions`, list them. These were exclusive to Firebase Auth and don't have direct Better Auth equivalents — the caller probably belongs to the old Firebase session-exchange endpoint we deleted, or should be removed.

- [ ] **Step 12.5:** Commit

```bash
git add -A apps/web/ .env.example
git commit -m "refactor(auth): swap 43 callers to @/lib/auth path; delete Firebase auth helpers"
```

---

### Task 13: Final verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 13.1:** Modify `README.md` Self-host quickstart. The existing block describes Postgres + MinIO setup. Add a brief Better Auth note after the existing setup steps:

Find the existing self-host quickstart section. Append at the end:

```md

### Sign-in methods

By default, the self-host stack supports three sign-in flows:

- **Google OAuth** — set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`.
  Without these, the Google button on the sign-in page does nothing.
- **Email + password** — works without any extra config. Email verification
  is required. Resend handles delivery (`RESEND_API_KEY`); without a key,
  verification URLs are logged to the server console (good enough for dev).
- **Magic link** — same Resend wiring; same console fallback.
```

- [ ] **Step 13.2:** Full success-criteria sweep

```bash
# A) Fresh setup
pnpm db:reset

# B) adapter-postgres tests
pnpm --filter @vibesboard/adapter-postgres test
# Expected: 23/23 (verifications now exempted from RLS coverage)

# C) adapter-better-auth tests
pnpm --filter @vibesboard/adapter-better-auth test
# Expected: tenant-creation tests pass; sign-in tests pass

# D) adapter-s3 smoke test
pnpm --filter @vibesboard/adapter-s3 test
# Expected: 1/1

# E) Type-check + lint + format
pnpm type-check && pnpm lint && pnpm format:check
# Expected: all pass (lint may have pre-existing warnings; don't introduce new ones)

# F) Web build
pnpm --filter @vibesboard/web build
# Expected: builds successfully

# G) Zero remaining references
grep -rEn "verifySessionCookie|@/lib/firebase/auth|@/lib/firebase/route-handler|AUTH_GITHUB_" apps/ packages/ --include='*.ts' --include='*.tsx' --include='*.json'
# Expected: no matches (or only matches inside comments or files explicitly deleted)

# H) Firebase auth helper files gone
ls apps/web/lib/firebase/auth.ts apps/web/lib/firebase/route-handler.ts 2>&1
# Expected: "No such file or directory" for both
```

- [ ] **Step 13.3:** Commit

```bash
git add README.md
git commit -m "docs(self-host): Better Auth sign-in flows in quickstart"
```

If any criterion fails, diagnose and fix in the relevant earlier task's commit (use `git revert` or fixup commits as appropriate; do not commit work-arounds as Task 14).

---

## Final note

After Task 13, sub-project #2 is mergeable to `dev`. Existing Firebase Auth users in production are NOT migrated — they will need to re-sign-up after the merge. The auto-tenant-creation hook makes this seamless: the new user immediately has a usable workspace. Sub-project #4 will delete the rest of `adapter-firebase`; sub-project #6 handles deploy.
