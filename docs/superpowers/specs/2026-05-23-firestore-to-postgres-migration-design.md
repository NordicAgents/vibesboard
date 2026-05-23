# Firestore → Postgres Incremental Migration — Design

**Date:** 2026-05-23
**Status:** Approved (design); pending spec review
**Scope:** Migrate the application's data plane from Firestore to the existing
Postgres adapter, incrementally and verifiably. **Firebase Auth is explicitly
out of scope** and stays in place; only Firestore (`adminDb`) data access is
being replaced.

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
- Make the *future* Firebase Auth migration cheap by designing the identity
  schema auth-agnostic now.

## Non-goals

- Migrating Firebase Auth (token verification, sign-in). Separate future
  project; `adapter-better-auth` is out of scope here.
- Migrating object storage (already on `adapter-s3`).
- Backfilling existing staging data (see Data strategy).
- Building a two-adapter (`IDataStore`) switch.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Existing staging data | **Wipe & reseed** | Staging data is disposable. No backfill/dual-write tooling. |
| Data-access shape | **Per-domain repository functions** in `adapter-postgres/src/repos/` | Hides Drizzle/SQL behind named, testable functions; one cutover point per domain. No interface ceremony. |
| Cutover unit | **Per-domain PRs merged to `dev`**, bottom-up by dependency | Small, reviewable, independently verifiable & revertible. Staging runs mixed until the final PR, but no domain is ever split across two stores. |
| Verification | **TDD repos + route integration tests + staging smoke** | Matches the repo's TDD mandate; asserts RLS/tenant isolation. |
| Firebase Auth | **Keep; migrate later** | Gated on the data plane existing; isolates risk; security blast radius. |

## Architecture

### Repository layer

Add per-domain modules under `packages/adapter-postgres/src/repos/`. Each
exports plain async functions wrapping Drizzle queries, run inside the existing
`tenant-context`/RLS helpers:

```
packages/adapter-postgres/src/
  repos/
    tenants.ts  agents.ts  files.ts  conversations.ts
    channels.ts  scheduling.ts  data-connections.ts  hooks.ts  usage.ts
    __tests__/        # repo + RLS isolation tests
  index.ts            # re-exports all repos (currently `export {}`)
```

The functions *are* the contract — e.g. `getTenantById(db, id)`,
`createAgent(db, input)`. The `IDataStore` stub stays unused and is removed in
teardown.

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

- **IDs.** Firestore auto-IDs become Postgres-generated keys (returned by the
  repo). Slug docs (`tenantSlugs`) become unique-constrained columns.
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

## Identity schema — auth-agnostic (makes future auth migration cheap)

This is the one correction folded in to keep the deferred Firebase Auth
migration cheap:

- `users` has its own **internal UUID primary key**, stable forever.
- The Firebase UID is stored in a separate `firebase_uid` mapping column
  (external-identity link), **not** used as the primary key.
- **All FKs across every other domain reference the internal UUID**, never the
  Firebase UID.

When Better Auth lands later, add a `better_auth_id` mapping (or use Better
Auth account-linking) — the internal UUID never changes, every dependent row
stays valid, and there is **no second identity migration**. The auth swap
becomes a localized change to the verify-token path.

Firebase Auth itself (`adminAuth`) is untouched: no passwords or sessions are
stored in Postgres during this migration.

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

1. **TDD on repos** — tests first for each repository function against a real
   test Postgres (extend the existing `test-utils.ts` + pgvector harness).
   Tests assert **RLS/tenant isolation**: a repo call under tenant A cannot see
   tenant B's rows.
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

- Firebase Auth → Better Auth migration (separate project; enabled cheaply by
  the auth-agnostic identity schema above).
