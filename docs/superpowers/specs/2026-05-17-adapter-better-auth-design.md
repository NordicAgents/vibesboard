# Auth Swap (Firebase Auth → Better Auth) — Design Spec

**Status:** Approved 2026-05-17 (sub-project #2 of self-host migration)
**Sub-project of:** Replace Firebase with self-hosted Postgres + S3 + Auth
**Predecessors:** sub-project #1 (adapter-postgres ✅), sub-project #3 (adapter-s3 ✅)
**Audience:** Engineer implementing with zero context for the codebase

---

## Context

Firebase Auth handles every sign-in flow today: Google OAuth, GitHub OAuth, session cookies via Firebase Admin's `createSessionCookie` / `verifySessionCookie`. The Firebase-Auth surface in the app:

- **5 server helpers** at [`apps/web/lib/firebase/auth.ts`](../../../apps/web/lib/firebase/auth.ts) and [`apps/web/lib/firebase/route-handler.ts`](../../../apps/web/lib/firebase/route-handler.ts): `verifySessionCookie`, `auth`, `createSessionCookie`, `requireAuth`, `requireTenantMember`, `requireTenantAdmin`, `requireSuperAdmin`
- **43 callers** in `apps/web/app/api/**` that use these guards
- **Middleware** at `apps/web/middleware.ts` checks `__session` cookie presence (doesn't verify; Edge runtime can't run Firebase Admin)
- **Client SDK** sign-in flow: Firebase Web SDK runs OAuth → `/api/auth/session` exchanges ID token for session cookie
- **Firestore tenant_members lookup** via `adminDb.collection(Collections.members(tenantId)).doc(userId).get()`

Sub-project #1 already added stub `users` and `sessions` tables. This sub-project extends them, adds Better Auth, and wires it through every layer.

### Approved design decisions

1. **Auth library:** Better Auth (TS-native, Drizzle adapter built-in, supports OAuth + email/password + magic links).
2. **Sign-in methods enabled by default:** Google OAuth, email + password, magic link.
3. **Skip:** GitHub OAuth (the existing `AUTH_GITHUB_*` env vars get removed).
4. **tenant_members data:** moves to Postgres in this sub-project. `requireTenantMember`/`requireTenantAdmin` read from Postgres `tenant_members`. **Greenfield** — no production data migration; existing Firestore users do not carry over.
5. **Sign-up flow auto-creates** a personal tenant + TENANT_ADMIN tenant_members row per new user, via a Better Auth `user.create.after` hook.

---

## Goal

Replace the Firebase-Auth identity layer with Better Auth on Postgres, port every callsite, delete the Firebase auth helpers.

### Non-goals

- No production Firebase user migration script.
- No deletion of `packages/adapter-firebase/admin.ts` or `client.ts` — sub-project #4.
- No `firebase.json` / Cloud Run deploy script changes — sub-project #6.
- No 2FA, password strength meter, account-linking UI.

---

## Architecture

### Package layout

```
packages/adapter-better-auth/                            (NEW)
  package.json                       # name: @vibesboard/adapter-better-auth
  tsconfig.json
  README.md
  src/
    index.ts                         # re-export the configured `auth` instance + types
    config.ts                        # Better Auth options (providers, hooks, plugins)
    email.ts                         # Resend or console-fallback senders
    on-user-create.ts                # auto-tenant-creation hook
    __tests__/
      email-password.test.ts
      magic-link.test.ts
      tenant-creation.test.ts
```

`adapter-better-auth` depends on `@vibesboard/adapter-postgres` (for the Drizzle adapter), `better-auth` (the library), and `resend` (for email; optional at runtime — falls back to console logging if `RESEND_API_KEY` is unset).

### Schema additions (in adapter-postgres)

Two new tables + columns added to `users`/`sessions`. Migration `0002_better_auth_tables.sql` (Drizzle-generated) + `0003_better_auth_rls.sql` (hand-written, mirrors 0001's pattern).

```ts
// adapter-postgres/src/schema/users.ts (modified — extend existing)
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  imageUrl: text('image_url'),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  emailVerified: boolean('email_verified').notNull().default(false),   // NEW
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),         // NEW
  userAgent: text('user_agent'),         // NEW
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, ...)

// adapter-postgres/src/schema/users.ts (NEW tables)
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),     // 'google' | 'credential' | 'magic-link'
  accountId: text('account_id').notNull(),       // Google sub; or = userId for credential
  password: text('password'),                    // bcrypt hash (credential only)
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index('accounts_user_idx').on(t.userId),
  byProvider: uniqueIndex('accounts_provider_account_idx').on(t.providerId, t.accountId),
}))

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey(),
  identifier: text('identifier').notNull(),      // email or magic-link key
  value: text('value').notNull(),                // token
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byIdentifier: index('verifications_identifier_idx').on(t.identifier),
}))
```

### RLS for the new tables

```sql
-- 0003_better_auth_rls.sql
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

-- verifications: no tenant_id, no stable user_id at row creation time
-- (a verification row is keyed by `identifier` which is the email being
-- verified BEFORE the user even has an account). Added to RLS_EXEMPT.
```

The `RLS_EXEMPT` allowlist in `rls-coverage.test.ts` gains `verifications` with a comment justifying the exemption: identifier-keyed, intentional global readability for the auth flow that runs without a user context yet.

### Better Auth configuration

```ts
// packages/adapter-better-auth/src/config.ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { getDb } from '@vibesboard/adapter-postgres/client'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { sendMagicLinkEmail, sendVerifyEmail, sendResetPasswordEmail } from './email.ts'
import { onUserCreateAfter } from './on-user-create.ts'

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
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
    google: process.env.AUTH_GOOGLE_ID
      ? {
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
        }
      : undefined,
  },
  plugins: [magicLink({ sendMagicLink: sendMagicLinkEmail })],
  databaseHooks: {
    user: { create: { after: onUserCreateAfter } },
  },
})
```

### `onUserCreate` hook

Runs after Better Auth inserts a new user row. Auto-creates a personal tenant and TENANT_ADMIN tenant_members row. Uses `createMigrateClient()` (BYPASSRLS role) because the auth flow has no tenant context yet — RLS can't enforce against a tenant that doesn't exist yet.

```ts
// packages/adapter-better-auth/src/on-user-create.ts
import { uuidv7 } from 'uuidv7'
import { createMigrateClient, schema } from '@vibesboard/adapter-postgres/client'
import { eq } from 'drizzle-orm'

export async function onUserCreateAfter(user: { id: string; email: string; name?: string | null }) {
  const db = createMigrateClient()

  // Idempotency: if this user already has a tenant_member row (e.g. retry),
  // do nothing. Better Auth hooks can fire twice in rare cases.
  const existing = await db
    .select({ tenantId: schema.tenantMembers.tenantId })
    .from(schema.tenantMembers)
    .where(eq(schema.tenantMembers.userId, user.id))
    .limit(1)
  if (existing.length > 0) return

  // Slug from email local-part with collision suffix
  const base = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)
  let slug = base || 'workspace'
  let suffix = 0
  while (
    (await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1)).length > 0
  ) {
    suffix++
    slug = `${base}-${suffix}`
  }

  const tenantId = uuidv7()
  await db.transaction(async (tx) => {
    await tx.insert(schema.tenants).values({
      id: tenantId,
      name: user.name ?? `${user.email}'s workspace`,
      slug,
      createdBy: user.id,
      isPersonal: true,
    })
    await tx.insert(schema.tenantMembers).values({
      tenantId,
      userId: user.id,
      role: 'TENANT_ADMIN',
    })
  })
}
```

### Email senders

```ts
// packages/adapter-better-auth/src/email.ts
import { Resend } from 'resend'

const FROM = process.env.NOTIFICATION_EMAIL_FROM ?? 'Vibesboard <noreply@example.com>'

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

export async function sendMagicLinkEmail({ email, url }: { email: string; url: string }) {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Magic link (dev fallback) for ${email}: ${url}`)
    return
  }
  await resend.emails.send({ from: FROM, to: email, subject: 'Sign in to Vibesboard', html: `<p><a href="${url}">Click to sign in</a></p>` })
}

export async function sendVerifyEmail({ user, url }: { user: { email: string }; url: string }) {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Verify email (dev fallback) for ${user.email}: ${url}`)
    return
  }
  await resend.emails.send({ from: FROM, to: user.email, subject: 'Verify your email', html: `<p><a href="${url}">Verify</a></p>` })
}

export async function sendResetPasswordEmail({ user, url }: { user: { email: string }; url: string }) {
  const resend = getResend()
  if (!resend) {
    console.log(`[adapter-better-auth] Reset password (dev fallback) for ${user.email}: ${url}`)
    return
  }
  await resend.emails.send({ from: FROM, to: user.email, subject: 'Reset your password', html: `<p><a href="${url}">Reset password</a></p>` })
}
```

**Dev-friendly fallback:** when `RESEND_API_KEY` is unset, senders log the URL to the console instead of failing. Self-hosters without a Resend account can still test the magic-link flow by copy-pasting from logs.

---

## App integration

### Server-side auth helpers (replaces `apps/web/lib/firebase/auth.ts`)

```ts
// apps/web/lib/auth.ts (NEW)
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

The existing `apps/web/auth.ts` (which is currently `export const auth = firebaseAuth`) becomes `export { auth } from './lib/auth'`. All 43 callers (`import { auth } from '@/auth'`) keep working without changes.

### Guards (replaces `apps/web/lib/firebase/route-handler.ts`)

```ts
// apps/web/lib/auth/route-handler.ts (NEW)
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

export async function requireTenantMember(tenantId: string): Promise<
  { ok: true; user: SessionUser; role: Role } | { ok: false; response: NextResponse }
> {
  const a = await requireAuth()
  if (!a.ok) return a

  // Read tenant_members via the migrate role for now — RLS would require
  // setting the tenant context first, but we're checking membership precisely
  // to determine that. Using the migrate client (BYPASSRLS) for this read is
  // safe because we filter explicitly on (tenantId, userId).
  const rows = await withTenant(
    { tenantId, userId: a.user.id, isSuperAdmin: false },
    () => withDb((tx) =>
      tx.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, a.user.id)))
        .limit(1),
    ),
  )

  if (rows.length === 0) {
    return { ok: false, response: new NextResponse('Forbidden', { status: 403 }) }
  }

  return { ok: true, user: a.user, role: rows[0].role as Role }
}

export async function requireTenantAdmin(tenantId: string) { /* role check on top of requireTenantMember */ }
export async function requireSuperAdmin() { /* reads users.isSuperAdmin from Postgres */ }
```

The signature of every guard is **identical** to today's Firebase version — callsites don't change.

A backwards-compat re-export shim at the OLD path keeps the 43 callers working without import-path edits:

```ts
// apps/web/lib/firebase/route-handler.ts — REPLACE entire contents with:
export {
  requireAuth, requireTenantMember, requireTenantAdmin, requireSuperAdmin
} from '../auth/route-handler'
```

Likewise `apps/web/lib/firebase/auth.ts` becomes a re-export of `../auth`. **Both shims are deleted** at the end of the sub-project once callers stabilize (Task 12 of the plan).

### Better Auth catch-all route

```ts
// apps/web/app/api/auth/[...all]/route.ts (NEW)
import { auth } from '@vibesboard/adapter-better-auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth.handler)
```

The existing `apps/web/app/api/auth/session/route.ts` (Firebase session-exchange endpoint) gets deleted.

### Middleware update

```ts
// apps/web/middleware.ts (modified line)
const SESSION_COOKIE_NAME = 'better-auth.session_token'
```

Everything else in middleware stays the same — it's a presence check only, not a verifier.

### Client-side sign-in

```ts
// apps/web/lib/auth-client.ts (NEW)
import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [magicLinkClient()],
})
```

Sign-in / sign-up pages rewritten to use `authClient.signIn.social({ provider: 'google' })`, `authClient.signIn.email({ email, password })`, `authClient.signIn.magicLink({ email })`.

---

## Tests

Three test files in `packages/adapter-better-auth/src/__tests__/`. All use `withTestDb` from adapter-postgres, get a real Better Auth instance bound to the test schema, and run real flows.

### `email-password.test.ts`

- Sign up with email + password → `users` row exists with `emailVerified: false`
- A `tenants` row is auto-created with `created_by: user.id` and `is_personal: true`
- A `tenant_members` row with role `TENANT_ADMIN` links them
- Email verification token exists in `verifications`
- Hitting the verify URL → `emailVerified: true`
- Sign in with same email + password → session created
- Sign in with wrong password → returns 401

### `magic-link.test.ts`

- Request magic link → `verifications` row inserted with `identifier = email`
- Email sender called with `{ email, url }` — captured via mock sink
- Hit the magic-link URL → session created, verification row consumed
- Hit the same URL twice → second hit fails (used-once)

### `tenant-creation.test.ts`

- Two new users with the same email prefix get distinct slugs (`acme`, `acme-1`)
- onUserCreateAfter is idempotent — calling it twice for the same user does not create a second tenant
- Re-running it after manual tenant deletion does create a new tenant (so it's idempotent on existence, not on identity)

---

## Deliverables

### New files

```
packages/adapter-better-auth/
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

apps/web/lib/auth.ts
apps/web/lib/auth/route-handler.ts
apps/web/lib/auth-client.ts
apps/web/app/api/auth/[...all]/route.ts

packages/adapter-postgres/drizzle/0002_better_auth_tables.sql
packages/adapter-postgres/drizzle/0003_better_auth_rls.sql
```

### Modified files

```
packages/adapter-postgres/src/schema/users.ts          — add columns; add accounts + verifications tables
packages/adapter-postgres/src/types.ts                  — re-export new types
packages/adapter-postgres/src/__tests__/rls-coverage.test.ts — add 'verifications' to RLS_EXEMPT with justification
apps/web/auth.ts                                       — re-export from './lib/auth'
apps/web/middleware.ts                                  — cookie name → 'better-auth.session_token'
apps/web/app/sign-in/page.tsx                           — Better Auth client
apps/web/app/sign-up/page.tsx                           — Better Auth client
apps/web/package.json                                   — add @vibesboard/adapter-better-auth dep
.env.example                                            — add BETTER_AUTH_SECRET; remove AUTH_GITHUB_*
README.md                                               — note Better Auth in quickstart
```

### Deleted files

```
apps/web/lib/firebase/auth.ts                           # replaced by apps/web/lib/auth.ts
apps/web/lib/firebase/route-handler.ts                  # replaced by apps/web/lib/auth/route-handler.ts
apps/web/app/api/auth/session/route.ts                  # Better Auth handles session creation directly
```

### Untouched (intentional)

- `packages/adapter-firebase/src/admin.ts`, `client.ts`, `index.ts` — sub-project #4
- `packages/adapter-firebase/package.json` — sub-project #4
- Cloud Run deploy script + Firebase project config — sub-project #6
- Production user migration — separate effort

---

## Success criteria

1. ✅ `pnpm db:reset` brings up stack; applies migrations 0000-0003 cleanly.
2. ✅ `pnpm --filter @vibesboard/adapter-postgres test` 23/23 (with `verifications` exempted) still pass.
3. ✅ `pnpm --filter @vibesboard/adapter-better-auth test` passes (3 test files, ~10 tests total).
4. ✅ `pnpm type-check`, `pnpm lint`, `pnpm format:check` pass.
5. ✅ `pnpm --filter @vibesboard/web build` succeeds.
6. ✅ `grep -r 'verifySessionCookie\|firebase/auth\|firebase/route-handler' apps/web/app apps/web/lib apps/web/middleware* | grep -v '\.md$'` returns zero matches.
7. ✅ Sign-up flow (manual smoke or automated end-to-end): new email → user lands in their auto-created personal tenant.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Better Auth's drizzleAdapter expects table/column names we didn't anticipate | Spec'd above based on Better Auth docs. If the implementer hits a mismatch, add the missing columns in a follow-up migration `0004_better_auth_fixup.sql` (forward-only). |
| 43 callers pass session.user.id around — Better Auth IDs are UUIDs (ours are UUID v7) vs Firebase's were string UIDs | Both are strings to TypeScript. Schema is unchanged (`users.id uuid`). The Better Auth user IDs flow through the same shape. |
| Middleware can't verify Better Auth sessions on Edge | Same posture as today's Firebase Auth — middleware checks cookie presence only. Server actions / route handlers do real verification via `auth()`. Documented. |
| Dev / staging continuity for the existing aerobase admin account | Greenfield by design. admin@aerobase.se re-signs-up after the merge. The auto-tenant-creation hook gives them a usable workspace immediately. |
| Resend not configured locally | Email senders fall back to console-logging the URL. Self-hosters can opt out of email entirely if they only use Google OAuth. |
| `onUserCreateAfter` runs in a transaction that fails halfway (user exists, tenant created, tenant_members insert fails) | Hook wraps the tenant + tenant_members in a single transaction; failure rolls both back. The user row exists but has no tenant — on next sign-in, the hook is re-run idempotently. |
| `requireTenantAdmin` performance: today reads one Firestore doc; now reads one Postgres row | Postgres is faster. No concern. |

---

## What sub-projects #4 / #5 / #6 inherit

- A fully working Better Auth identity layer on Postgres.
- `auth()` and the guard helpers return the same shapes as today — Firestore-coupled internals are gone.
- A new `@vibesboard/adapter-better-auth` package other sub-projects can extend if they need auth-aware behaviour.
- One less coupling to `adapter-firebase` — only `admin.ts` and `client.ts` remain after this PR.
