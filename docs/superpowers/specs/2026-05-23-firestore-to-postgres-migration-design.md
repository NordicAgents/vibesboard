# Firestore → Postgres Incremental Migration — Design

**Date:** 2026-05-23
**Status:** Approved (design); pending spec review
**Scope:** Migrate the application's data plane from Firestore to the existing
Postgres adapter, incrementally and verifiably. **Authentication is already on
Better Auth** (see below) — this migration is purely Firestore (`adminDb`) data
access → Postgres. No auth work is in scope.

## Background

Vibesboard is migrating to a self-hostable stack. The Postgres data plane
(`@vibesboard/adapter-postgres`) already ships a full Drizzle schema (tenants,
users, agents, conversations, channels, scheduling, policy, branding, files,
vectors, data) with RLS and tenant-context helpers, but its `index.ts` exports
nothing and the running app still reads/writes Firestore directly.

Object storage already cut over cleanly to `@vibesboard/adapter-s3` (which can
target GCS via its S3-interop endpoint in production, MinIO in dev). Storage is
therefore **not** part of this migration — only Firestore data and pgvector
embeddings are.

The `IDataStore` port in `contracts` is a stub (`kind: string` only) and the
intended generic abstraction was never built. Routes and feature packages call
`adminDb.collection(Collections.x)...` directly, using Firestore idioms
(`batch()`, `FieldValue.serverTimestamp()`, subcollections).

There are ~30 Firestore call-sites across `apps/web` (routes, server
components, `actions.ts`, `lib/`) and feature packages (`ai`, `agents`,
`channel-*`, `inbox`, `scheduling`, `data`).

## Goals

- Replace all Firestore data access with Postgres, one domain at a time.
- Keep staging working at every step ("everything works").
- Mop up the residual `adminAuth` use in `admin/tenants` as that route migrates.

## Non-goals

- Any authentication work. Auth is **already on Better Auth** (`lib/auth.ts` →
  `@vibesboard/adapter-better-auth`; `session.user.id` is the Postgres `users.id`
  UUID). The `users`/`sessions`/`accounts`/`verifications` tables already exist.
- Google RISC / Cross-Account Protection (`adapter-google/src/risc.ts`, the only
  remaining `adminAuth` consumer besides `admin/tenants`). Left on Firebase;
  revisit only on a full de-Google.
- Migrating object storage (already on `adapter-s3`).
- Backfilling existing staging data (see Data strategy).
- Building a two-adapter (`IDataStore`) switch.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Existing staging data | **Wipe & reseed** | Staging data is disposable. No backfill/dual-write tooling. |
| Data-access shape | **Direct Drizzle in the consuming code + `rowToX` mappers**, following the #170 precedent | One commit of merged, live-verified precedent (`lib/tenant-context.ts`, `agents/db.ts`, `policy/permissions.ts`, `api/agents/route.ts`). Co-located helpers are still testable units; consistency with merged code wins over a new `repos/` abstraction. |
| Cutover unit | **Per-domain PRs merged to `dev`**, bottom-up by dependency | Small, reviewable, independently verifiable & revertible. Staging runs mixed until the final PR, but no domain is ever split across two stores. |
| Verification | **TDD repos + route integration tests + staging smoke** | Matches the repo's TDD mandate; asserts RLS/tenant isolation. |
| Authentication | **Already on Better Auth — no work** | `lib/auth.ts` resolves sessions via Better Auth; `session.user.id` is the Postgres UUID. Nothing to migrate. |

## Already migrated by #170 (do not re-do)

Commit #170 (merged) already moved part of the identity/agents domains to
Postgres, and set the pattern this migration follows:

- `apps/web/lib/tenant-context.ts` — `getActiveTenant`, `ensureActiveTenant`,
  `getUserTenants`, `getTenantById`, `getTenantContext`, `ensurePersonalTenant`,
  `enrichTenantsWithMembers`, `getActiveTenantBranding`.
- `packages/policy/src/permissions.ts` — `isMemberOfTenant`, `isSuperAdmin`,
  `isTenantAdmin`, `getUserRole`, `hasTenantAdminAccess`.
- `packages/agents/src/db.ts` — `ensureUniqueSlug`, `mapAgentDoc`,
  `createAgentSlug`.
- `apps/web/app/api/agents/route.ts` — agents GET/POST.
- `apps/web/middleware.ts` — already free of `adminDb`.
- `apps/web/lib/auth.ts` + `apps/web/lib/auth/route-handler.ts` — auth is on
  Better Auth; `requireAuth`/`requireTenantMember`/`requireTenantAdmin`/
  `requireSuperAdmin` already query Postgres (`tenantMembers`, `users`) under
  `withTenant`/`withDb`. Reuse these in every migrated route.

## Architecture

### Data-access pattern (established by #170)

Data access lives **in the consuming code** — the route handler, or a
co-located helper module (`apps/web/lib/*`, `packages/<pkg>/src/*`) — using
Drizzle directly via subpath imports:

```ts
import { getMigrateDb } from '@vibesboard/adapter-postgres/client' // BYPASSRLS, identity ops
import { withDb }       from '@vibesboard/adapter-postgres/client' // RLS tenant-scoped ops
import { tenants, tenantMembers, users } from '@vibesboard/adapter-postgres/schema'
import { uuidv7 } from 'uuidv7'
```

Conventions, all taken from #170:

- **Mappers.** A `rowToX` / `toXRecord` function normalizes a Postgres row to
  the legacy document shape the UI/API already expect (e.g. `agentUrl`,
  `tenantSlug`, ISO-string timestamps). Mappers keep the migration invisible to
  callers and the frontend.
- **IDs.** `uuidv7()` generated in app code, not DB-side.
- **Identity/tenancy ops use `getMigrateDb()` (BYPASSRLS)** with explicit
  `WHERE user_id = … / tenant_id = …` filters, because resolving *which* tenant
  a request belongs to runs *before* any tenant GUC context exists, so RLS
  `tenant_id = current_tenant_id` policies would return zero rows. Tenant-scoped
  domain ops (agents, conversations, files, …) use `withDb` under RLS.

The `IDataStore` stub stays unused and is removed in teardown. No `repos/`
layer is introduced.

### Cutover mechanism

A domain is "migrated" when every call-site for its collections imports the
Postgres repo instead of `adminDb`. Migration proceeds **bottom-up by
dependency**, so a migrated domain only ever reads *forward* into
already-migrated Postgres repos; not-yet-migrated (Firestore) domains read
forward into migrated repos for their cross-domain reads. No Postgres domain
ever reads back into Firestore.

### The "manage both" window

During the transition staging runs **both** stores. The seed must populate
both: Firestore for un-migrated domains, Postgres for migrated ones. This is the
temporary cost of incremental migration; it ends at the teardown PR.

## Firestore → Postgres translation rules

Applied once, inside each repo:

- **IDs.** Firestore auto-IDs become `uuidv7()` values generated in app code.
  Slug docs (`tenantSlugs`) become unique-constrained columns.
- **Timestamps.** `FieldValue.serverTimestamp()` → column `default now()` /
  explicit `new Date()`.
- **Subcollections → child tables.** `members(tenantId)`, `hookJobs(...)`, etc.
  become tables with `tenant_id` (and parent) FKs enforced by RLS; listing a
  subcollection becomes a `WHERE tenant_id = $1` query.
- **Denormalized counters.** e.g. `membersCount` becomes `COUNT(*)` — no stored
  counter to drift.
- **Batches/atomicity.** Multi-doc `batch()` writes (e.g. create-team writing
  tenant + slug + branding + member + user) become a single Drizzle
  **transaction**.

## Identity schema (already auth-agnostic)

No work needed — the schema already does the right thing:

- `users` has an **internal UUID primary key** (`uuid('id').primaryKey()`),
  stable forever. There is no `firebase_uid` column and none is needed.
- External identity is handled by Better Auth's `accounts` table
  (`providerId` + `accountId`), and `session.user.id` already resolves to the
  internal `users.id` UUID.
- All FKs across domains already reference the internal UUID.

Migration code therefore reads the current user as `session.user.id` (a
Postgres UUID) — no Firebase UID translation anywhere.

## Migration order (PR sequence)

Bottom-up by dependency. Mapped from the `Collections` helper → Postgres schema
→ call-sites.

| # | PR / Domain | Collections | Key call-sites |
|---|---|---|---|
| **1** | **Identity & tenancy** (foundation) | `tenants`, `tenantSlugs`, `members`, `users`, `featureToggles`, `branding` | `middleware.ts`, `lib/tenant-context.ts`, `lib/auth/*`, `lib/access-gate.ts`, `lib/tenant-theme.ts`, `admin/tenants*`, `admin/feature-flags*`, `tenants/create-team`, `tenants/[id]/{users/role,branding,config}`, `invitations/accept`, `settings/layout`, `functions/on-user-created`, `adapter-better-auth` |
| **2** | **Agents & links** | `agents`, `agentLinks`, `inviteCodes` | `agents/[id]`, `[tenantSlug]/[agentSlug]`, `[tenantSlug]/l/[linkSlug]`, `agents/server.ts`, `inbox/resolve-agent` |
| **3** | **Files & file-RAG** | `agentFiles`, `fileChunks` | `agents/[id]/files`, `agents/file-processing`, `ai/{embeddings,file-processor,file-search,rag-retriever}`, `functions/on-file-created` |
| **4** | **Conversations & convo-RAG** | `conversations`, `conversationRefs`, `conversationChunks`, `dataLogs` | `agents/[id]/chat`, `public/.../chat`, `hooks/[hookId]/chat`, `public/.../feedback`, `agents/conversations`, `ai/conversation-rag`, `sync-embeddings` |
| **5** | **Channels / inbox** | `whatsappInbox*`, `instagramInbox*`, `chatwootConnections` | `channel-whatsapp/*`, `channel-instagram/*`, `channel-chatwoot/*`, `inbox/handler`, `tenants/[id]/{whatsapp,instagram}-inbox/*` |
| **6** | **Scheduling & data connections** | `calendarConnections`, `bookings`, `bookingEnquiries`, `dataConnections` | `scheduling/connections`, `ai/actions/appointments`, `ai/actions/data`, `data/connections` |
| **7** | **Hooks, usage, notifications + teardown** | `hooks`, `hookJobs`, `usageLogs`, `usageRollups`, `notifications` | `agents/hooks`, `agents/limits`, `notifications`, `admin/.../usage`, `meta/data-deletion` — **plus** delete `adminDb` data access, the Firestore seed, and `firestore.rules`/indexes for migrated collections |

**PR 1** is the keystone and largest (tenant resolution runs on every request).
If too large to review, split into 1a (tenants/users/members) and 1b
(branding/feature-toggles) — decided when we reach it.

**PR 7** is teardown: only after the last domain flips do we remove `adminDb`
data access, the Firestore seed, and the rules/index files. "Manage both" ends
here.

## Verification (per PR)

1. **TDD on data-access helpers** — tests first for each co-located data
   helper (e.g. `lib/tenant-context.ts`, route handlers, package `db.ts`)
   against a real test Postgres (extend the existing `test-utils.ts` + pgvector
   harness). Tests assert **RLS/tenant isolation**: a tenant-scoped (`withDb`)
   call under tenant A cannot see tenant B's rows.
2. **Route integration tests** — for each migrated API route, exercise the
   handler against test Postgres, asserting request→repo→response wiring
   (status, tenant scoping, shape).
3. **Staging smoke checklist** — a short per-domain manual script in the PR
   description, run after deploy-to-staging before the next PR.

## Rollback

Per-domain PRs make rollback a `git revert` of that PR; the previous domains'
paths remain intact. Staging data is disposable, so no data unwind is needed.
The next domain's PR is not merged until the current one is smoke-verified green
on staging.

## Risks / watch-items

- **PR 1 blast radius** — middleware + every route depend on tenant resolution.
  Highest-risk PR; lean on integration tests + thorough staging smoke before
  merge.
- **RAG vectors (PRs 3–4)** — `conversationChunks`/`fileChunks` carry
  embeddings. Confirm pgvector dimensions match what `ai/embeddings.ts`
  produces, or retrieval silently breaks. A repo test must round-trip an
  embedding and run a similarity query.
- **Cloud Run config** — staging needs `DATABASE_URL`/`S3_*` secrets wired into
  `deploy-cloudrun.yml` before PR 1 deploys. If absent, that is a prerequisite
  task within PR 1.

## Out-of-scope follow-ups

- Google RISC (`adapter-google/src/risc.ts`) and the residual `adminAuth`
  import — addressed only on a future full de-Google effort.
