# Firebase Auth / RISC → Better Auth Migration — Design

**Date:** 2026-05-25
**Status:** Approved (brainstorming)
**Follows:** the completed Firestore→Postgres data-plane migration (Phases 1–7). This removes the *last* Firebase dependency, leaving the app fully Firebase-free except Better Auth's Google OAuth **client** (which does not use `firebase-admin`).

## Problem

After the auth migration to Better Auth, the only remaining `firebase-admin` usage is Google **RISC (Cross-Account Protection)** in `packages/adapter-google/src/risc.ts`. It:

1. Resolves a Google `sub` → a **Firebase** UID via `adminAuth.getUsers([{ providerId: 'google.com', providerUid: sub }])`.
2. Acts on **Firebase** Auth: `adminAuth.revokeRefreshTokens(uid)`, `adminAuth.updateUser(uid, { disabled })`.

But the live auth system is **Better Auth** — sessions live in the Postgres `sessions` table and Google identities in the `accounts` table. So a Google security signal (e.g. `sessions-revoked` for a compromised account) **currently does not revoke the user's real session** — RISC is silently ineffective. Google OAuth ("Sign in with Google") is an active login method (`socialProviders.google` in the Better Auth config), so Cross-Account Protection is genuinely wanted.

## Goal

Re-point RISC at Better Auth + Postgres so Cross-Account Protection is effective again, then delete `adapter-firebase` / `firebase-admin` entirely.

## Non-goals

- Changing the RISC token verification (JWKS/RS256/issuer) — it is pure crypto, already Firebase-free, and stays as-is.
- Changing Google OAuth login (Better Auth `socialProviders.google`) — unrelated to `firebase-admin`.
- A general admin "ban user" UI — out of scope (a `disabled` flag is added, but only RISC and session validation consume it).

## Architecture

RISC remains a thin, signature-verified webhook receiver. Only its **effect side** moves from Firebase to Postgres/Better Auth.

| Component | Change |
|---|---|
| `apps/web/app/api/webhooks/google-risc/route.ts` | Unchanged (calls verify + handle). |
| `adapter-google/src/risc.ts` `verifyRiscToken` | Unchanged (JWKS, RS256, issuer). |
| `adapter-google/src/risc.ts` `handleRiscEvents` | Rewritten to call new `adapter-better-auth` helpers instead of `adminAuth`. |
| `adapter-google/src/risc.ts` `resolveFirebaseUid` | Removed; replaced by `resolveUserIdByGoogleSub` in `adapter-better-auth`. |
| `adapter-better-auth` (new helpers) | `resolveUserIdByGoogleSub`, `revokeUserSessions`, `setUserDisabled`. |
| `users` table | New `disabled boolean NOT NULL DEFAULT false` column (migration 0010). |
| Better Auth config | Enforce `disabled` at session validation / sign-in. |
| `adapter-firebase` package + `firebase-admin` | Deleted repo-wide. |

### New helpers (in `@vibesboard/adapter-better-auth`)

Co-located with the auth system that owns the `accounts`/`sessions`/`users` tables. Each takes an optional `db: Db = getMigrateDb()` last param (BYPASSRLS — the webhook has no tenant/session context) and is `withTestDb`-tested.

```ts
// Resolve a Google OAuth subject to our internal user id.
// Better Auth stores social identities in `accounts` with provider_id='google'
// and account_id = the provider's user id (the Google `sub`).
// Guards for a legacy 'google.com' provider_id too (verify against live data).
resolveUserIdByGoogleSub(sub: string, db?): Promise<string | null>

// Delete all Better Auth sessions for a user (logs them out everywhere).
revokeUserSessions(userId: string, db?): Promise<void>   // DELETE FROM sessions WHERE user_id = $1

// Toggle the disabled flag.
setUserDisabled(userId: string, disabled: boolean, db?): Promise<void>
```

### Event → action mapping (`handleRiscEvents`)

| RISC event | Action |
|---|---|
| `sessions-revoked`, `tokens-revoked`, `token-revoked`, `account-credential-change-required` | `revokeUserSessions(userId)` |
| `account-disabled` | `setUserDisabled(userId, true)` **then** `revokeUserSessions(userId)` |
| `account-enabled` | `setUserDisabled(userId, false)` |
| `verification` | ack / no-op (Google's periodic stream verification) |
| unknown sub / no matching account | log + skip (current behavior) |
| unknown event type | log + skip (current behavior) |

### `disabled` enforcement

- **Migration 0010:** `ALTER TABLE users ADD COLUMN disabled boolean NOT NULL DEFAULT false;` (no RLS change — `users` already has its `users_self` policy; the column rides along).
- **Enforcement:** in the Better Auth config, block disabled users at the session layer — a `databaseHooks.session.create.before` that rejects creating a session for a `disabled` user (covers fresh Google re-login), plus a guard in the app's server-side session read (`apps/web/lib` `getSession`/`auth()` path or middleware) that treats a disabled user as unauthenticated. Disabling already deletes existing sessions; this prevents re-establishing one until re-enabled.

## Firebase removal (end state)

After RISC no longer imports `adapter-firebase`:
- Remove the `@vibesboard/adapter-firebase` dep from `adapter-google/package.json`.
- Delete the `packages/adapter-firebase` package and remove `firebase-admin` from every `package.json`; `pnpm install` + commit the lockfile.
- Remove any residual Firebase admin init / `firebase.json` admin config and the `FIREBASE_SERVICE_ACCOUNT_KEY` runtime expectation for admin (keep only what Better Auth's Google OAuth needs — client id/secret, which are not firebase-admin).
- Delete the now-dead `firestore-types.ts` if the two surviving type aliases (`AgentMode`, `QuickSuggestionsMode`) are first relocated into `contracts/src/types.ts`.
- **Final gate:** `grep -rn "firebase-admin\|adapter-firebase\|adminAuth" packages apps` (excluding node_modules/.next) → zero in production source.

## Testing

`withTestDb` integration tests in `adapter-better-auth`:
- `resolveUserIdByGoogleSub` returns the user for a seeded `accounts` row (provider_id='google'); null for unknown sub.
- `revokeUserSessions` deletes only the target user's sessions.
- `setUserDisabled` toggles the flag.
- A `handleRiscEvents` test (seed user+account+sessions) per event type: sessions deleted on revoke events; `disabled` set + sessions deleted on account-disabled; `disabled` cleared on account-enabled; unknown sub no-ops.
- `verifyRiscToken` keeps its existing coverage (unchanged).
- Better Auth enforcement: a disabled user cannot establish a session (config-level test or an integration assertion).

## Rollout

Single feature branch → PR → CI → merge `dev` → CD deploy (migration 0010 applies) → staging verification: POST a simulated RISC SET (signed test payload, or unit-level since real Google signals are hard to trigger) and assert sessions are revoked / `disabled` toggled in Postgres. Confirm the deployed app boots with no `FIREBASE_SERVICE_ACCOUNT_KEY` and no firebase-admin in the bundle.

## Risks

- **`provider_id` value:** Better Auth uses `'google'`; legacy rows might use `'google.com'`. The resolver must be verified against live `accounts` data and guard both. (Verification step in the plan.)
- **Disabled enforcement gap:** if the enforcement hook is missed, a disabled user could re-login. Mitigated by testing the session-create block + the server-side guard.
- **Removing `FIREBASE_SERVICE_ACCOUNT_KEY`:** confirm nothing else (storage, etc.) still needs Firebase admin before deleting — the prior teardown already removed `adminStorage` consumers; this verifies the last one.
