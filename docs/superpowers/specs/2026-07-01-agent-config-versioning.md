# Agent Config Versioning — Design Spec

- **Date:** 2026-07-01
- **Branch:** `feat/agent-versioning` (worktree off `dev`)
- **Status:** Backend implemented (schema, migration + backfill, versioning module,
  wired write paths, versions API, tests — all type-checked and passing on a local
  Postgres). UI (§6) deferred to a follow-up. Restore re-triggers embeddings sync and
  warns on files missing from storage (§10 decision resolved).

## 1. Context & Current State

Agents in Vibesboard are stored as a **single mutable row** in the `agents` table
(`packages/adapter-postgres/src/schema/agents.ts:82`). The row holds the full agent
config — `instructions`, `tools`, `fileKeys`, `handoffTargets`, `collectionFields`,
`maxResponses`/`maxAgentResponses`, `retrievalStrategy`, and the jsonb config blobs
(`notificationConfig`, `schedulingConfig`, `bookingConfig`, `dataConfig`,
`calendarAvailabilityConfig`) — alongside runtime counters (`totalResponseCount`,
`lastEmbeddingsSyncAt`). The only temporal columns are `createdAt` / `updatedAt`.

Write paths today:

- **Create:** `POST apps/web/app/api/agents/route.ts` — builds `insertValues`, assigns a
  `uuidv7()` id, and `getMigrateDb().insert(agentsTable).values(...).returning()`.
- **Update:** `PATCH apps/web/app/api/agents/[id]/route.ts` — builds a partial `set`
  object from whichever fields are present in the payload and `.update(agentsTable)
  .set(set).where(eq(id))` — **overwrites in place**.
- **Delete:** `DELETE` in the same file.
- DB helpers/mappers live in `packages/agents/src/db.ts` (`mapAgentDoc`,
  `agentRowToVibeAgent`, `toAgentRecord`) and read helpers in
  `packages/agents/src/server.ts` (`getAgentById`, `getAgentForMember`, …).

Writes go through `getMigrateDb()` (the `vibesboard_migrate` / `BYPASSRLS` role); reads
in `packages/agents` go through the RLS-scoped app role inside `withTenant`.

**Problem:** there is no version history. Editing an agent destroys the previous
config — no rollback, no audit of who changed what, no ability to diff or restore a
prior prompt/tool set. For a multi-tenant product where a bad prompt edit can silently
degrade a live agent, this is a real gap.

## 2. Goals & Non-Goals

**Goals**

1. Every create and every config-changing update records an **immutable version
   snapshot** of the agent's configuration.
2. **List / view / diff / restore** a prior version from API and UI.
3. Capture **who** made the change and **when** (`createdBy`, `createdAt`).
4. Preserve tenant isolation (RLS) and the existing agent read/write API shape — no
   breaking changes to current consumers.
5. Backfill: existing agents get a `v1` snapshot representing their current state.

**Non-Goals (this phase)**

- **Draft vs. published workflow** (editing a draft without affecting the live agent).
  Deferred to Phase 2 (§7); the schema is designed to allow it later.
- Versioning of **conversations, messages, files, or embeddings** — only agent *config*.
- Versioning of **runtime counters** (`totalResponseCount`, `lastEmbeddingsSyncAt`) —
  these are operational state, explicitly excluded from snapshots.
- Automatic version pruning / retention limits (note as follow-up).

## 2a. User Flow (end-to-end)

How versioning appears to the person managing an agent. Versioning is **invisible on the
happy path** — it only surfaces when the user wants history.

1. **Create an agent** — unchanged from today. The user fills the create form and saves;
   behind the scenes the agent row and its `v1` snapshot are written together. No new UI.

2. **Edit an agent** — the edit form gains one optional field, **"Describe this
   change"**. On save, a new version `vN+1` is snapshotted and `currentVersion` bumps. If
   the edit changed nothing, the no-op guard skips creating a version. The user sees the
   same "saved" confirmation as before.

3. **View history** — a new **"History"** tab on the agent lists versions newest-first:
   version number, who, when, the change note, and a **source badge**:
   - `update` — a person edited the agent
   - `restore` — a prior version was restored (shows "restored from vX")
   - `file-sync` — files were added/removed (config moved without a manual edit)
   - `system` — an automatic change (e.g. a connection was disabled)

   The badges answer "why did my agent change?" without the user having to guess.

4. **Inspect / compare** — clicking a version opens a read-only view of that snapshot;
   selecting two versions shows a field-level **diff** (instructions, tools, configs).

5. **Restore** — the user picks an older version and confirms **Restore**. Restore is
   **forward-only**: restoring v3 while on v7 creates a new v8 identical to v3 and the
   live agent immediately serves v3's config. History is never rewritten, and a new
   "restored from v3" entry appears at the top.

**Flow edge cases the design intentionally shapes:**
- Changing/clearing the **access password produces no history entry** — it is a
  credential, excluded from snapshots (§3.1). Confirm this is the intended UX.
- **Restore + missing files:** if a restored version references files deleted since,
  restore degrades gracefully (skips missing keys, warns). Whether restore also re-runs
  embeddings sync is the one open decision (§10).

## 3. Data Model

New table `agent_versions` in `packages/adapter-postgres/src/schema/agents.ts`. Store
the versioned config as a **single jsonb snapshot** rather than mirroring every column —
this decouples the history table from future `agents` column churn.

```ts
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: uuid('id').primaryKey(), // generated with uuidv7() at insert, matching agents
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(), // monotonic per agent, starts at 1
    // Full config snapshot — the union of the config fields listed in §3.1,
    // shape-validated by a zod schema in @vibesboard/agents.
    config: jsonb('config').$type<AgentConfigSnapshot>().notNull(),
    // Provenance
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    changeNote: text('change_note'), // optional user-supplied message
    source: text('source', {
      enum: ['create', 'update', 'restore', 'backfill'],
    }).notNull(),
    restoredFrom: integer('restored_from'), // versionNo this was restored from, if source='restore'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // one row per (agent, versionNo); also the lookup index
    agentVersionUnique: uniqueIndex('agent_versions_agent_version_uq').on(
      t.agentId,
      t.versionNo,
    ),
    byAgent: index('agent_versions_agent_idx').on(t.agentId, t.versionNo.desc()),
    byTenant: index('agent_versions_tenant_idx').on(t.tenantId),
  }),
)
```

Add a pointer column to `agents`:

```ts
currentVersion: integer('current_version').notNull().default(1),
```

`agents.currentVersion` always equals the `versionNo` of the row the live agent
reflects. (We keep an integer pointer rather than a FK to `agent_versions.id` to avoid a
circular insert dependency and to keep the "current" concept human-readable.)

### 3.1 What goes in the snapshot

Config fields only (exclude ids, tenant/user, slug, counters, timestamps):
`name`, `instructions`, `mode`, `allowAnonymous`, `greetingText`,
`quickSuggestionsMode`, `quickSuggestionsCount`, `tools`, `fileKeys`,
`handoffTargets`, `collectionFields`, `maxResponses`, `maxAgentResponses`,
`retrievalStrategy`, `googleReviewEnabled`, `googlePlaceId`, `notificationConfig`,
`schedulingConfig`, `bookingConfig`, `dataConfig`, `calendarAvailabilityConfig`.

Define `AgentConfigSnapshot` + a builder `toAgentConfigSnapshot(row)` and applier
`applySnapshotToUpdate(snapshot)` in `packages/agents/src/versioning.ts` so all
config-mutating paths (§4) share one source of truth for the field set.

> **Decision (resolved): `accessPasswordHash` is EXCLUDED from snapshots.** It is a
> credential, not editorial config, and it is written by a *separate* route
> (`packages/agents/src/access-password.ts`), never by PATCH. Versioning it would let a
> restore silently resurrect an old password gate and would force a "never return to
> client" caveat throughout. The access-gate is intentionally orthogonal to config
> history. (`slug` is likewise excluded — it is derived from `name` at create via
> `createAgentSlug`/`ensureUniqueSlug` and is never mutated by PATCH.)

## 4. Write-Path Changes

All writes stay on `getMigrateDb()` and must be **transactional** (agent row + version
row in one tx, via the established `db.transaction(async (tx) => …)` pattern) so a
snapshot can never desync from the pointer. New version-row ids use `uuidv7()` (the
`uuidv7` package already used for agent ids in `POST /api/agents/route.ts`).

### 4.1 CRITICAL: every config mutation must go through the versioning module

Agent config columns are **not** written only by PATCH. An audit of `.update(agents)` /
`.update(agentsTable)` call sites found three paths that mutate *versioned* config
fields outside the create/PATCH flow — each would silently desync the live row from its
latest snapshot if left alone:

| Call site | Mutates | Action |
| --- | --- | --- |
| `apps/web/app/api/agents/[id]/files/route.ts:163` (+ file delete/ingest routes) | `fileKeys` on upload/removal | route through `updateAgentWithVersion` (`source = 'file-sync'`) |
| `packages/agents/src/server.ts:109` `disableConfigField` | `schedulingConfig` / `calendarAvailabilityConfig` `.enabled → false` on connection disable | route through `updateAgentWithVersion` (`source = 'system'`) |
| `packages/agents/src/access-password.ts:18,30` | `accessPasswordHash` | **no version** — excluded field (§3.1); leave as-is |

The following are **operational counters**, correctly *not* versioned (leave as direct
updates): `packages/agents/src/limits.ts:22,49` (`totalResponseCount`) and
`packages/agents/src/db.ts:213` `setAgentEmbeddingsSyncedAt` (`lastEmbeddingsSyncAt`).

Extend the `source` enum in §3 to: `'create' | 'update' | 'restore' | 'backfill' |
'file-sync' | 'system'`.

### 4.2 The paths

- **Create** (`POST /api/agents`): in the same tx as the agent insert, insert
  `agent_versions` row with `versionNo = 1`, `source = 'create'`, `config =
  toAgentConfigSnapshot(inserted)`; set `agents.currentVersion = 1`.
- **Update** (`PATCH /api/agents/[id]`, files routes, `disableConfigField`): apply the
  partial `set`, then compute the resulting full config, insert a new `agent_versions`
  row with `versionNo = currentVersion + 1`, the appropriate `source`, `changeNote`
  (PATCH only); bump `agents.currentVersion`. Use `SELECT … FOR UPDATE` on the agent row
  (or rely on the `(agentId, versionNo)` unique index) to serialize concurrent edits and
  avoid duplicate version numbers.
  - **No-op guard:** if the new snapshot is byte-identical to the current version's
    config (compare config only, ignoring `updatedAt`), skip creating a new version.
    This keeps churny system writes (e.g. a re-upload that adds no new file keys) from
    producing empty versions.
- **Restore** (new, §5): insert a new version whose `config` = the chosen prior
  version's config, `source = 'restore'`, `restoredFrom = <n>`; apply that config to the
  live `agents` row; bump `currentVersion`. Restore is **forward-only** (never rewrites
  history) — restoring v3 while on v7 creates v8 equal to v3.

Centralize this in `packages/agents/src/versioning.ts`:
`createAgentWithVersion(...)`, `updateAgentWithVersion(id, patch, {actor, note, source})`,
`restoreAgentVersion(id, versionNo, {actor, note})`, `listAgentVersions(id)`,
`getAgentVersion(id, versionNo)`. The API routes and the file/connection paths become
thin wrappers — this is the single choke point that guarantees no drift.

## 5. API

Extend under the existing agents route group:

- `GET  /api/agents/[id]/versions` — list (paginated, newest first): `versionNo`,
  `createdAt`, `createdBy` (resolved to name), `source`, `changeNote`, `restoredFrom`.
  No `config` body in the list.
- `GET  /api/agents/[id]/versions/[versionNo]` — full snapshot (password hash stripped).
- `POST /api/agents/[id]/versions/[versionNo]/restore` — perform restore; returns the
  updated agent (same shape as PATCH today).
- Optional: `GET /api/agents/[id]/versions/diff?from=&to=` — server-side field-level
  diff, or compute client-side from two snapshot fetches (simpler; recommended for MVP).
- `PATCH /api/agents/[id]` gains an optional `changeNote` field in the payload.

All new routes reuse the existing member/tenant authorization already applied in the
agents route group. Responses strip `accessPasswordHash`.

## 6. UI (apps/web)

- Agent settings → new **"History"** tab (`apps/web/components/agents/…`): version
  timeline (who / when / note / source badge), "View" (read-only config), "Restore"
  (confirm dialog), and a two-version diff view highlighting changed fields.
- The edit form gains an optional **"Describe this change"** note field, sent as
  `changeNote`.

## 7. Phase 2 (deferred — design accommodates it)

Draft/publish: add `status` (`draft` | `published`) to `agent_versions` and a
`publishedVersion` pointer on `agents`. The runtime reads `publishedVersion`; the editor
edits a `draft` version; publishing flips the pointer. Not in scope now, but the
snapshot-per-version model above supports it without a schema rewrite.

## 8. Migration & Backfill

1. `bun run db:generate` after adding the schema → new Drizzle migration.
2. **RLS policy (required — multi-tenant).** `agent_versions` is tenant-scoped, so it
   MUST get a row-level-security policy mirroring `agents` (tenant GUC check) in
   `packages/adapter-postgres/src/rls.ts` / the migration that enables RLS. Drizzle's
   `db:generate` does **not** emit RLS policies — this is a hand-written step and is
   easy to forget; without it the app role either leaks cross-tenant rows or (with RLS
   forced) reads zero. Add it in the same migration as the table.
3. Data migration (in the same or a follow-up migration): for every existing agent,
   insert one `agent_versions` row `versionNo = 1`, `source = 'backfill'`,
   `config = snapshot(current row)`, `createdBy = agents.userId` (nullable — `userId`
   can be null), and set `agents.currentVersion = 1`. Must run under the migrate role.
4. `agents.currentVersion` ships with `.default(1)` so the column is safe pre-backfill.

## 9. Testing (Vitest, per the test-suite spec)

- **Unit** (`packages/agents`): `toAgentConfigSnapshot` field coverage; no-op guard;
  version-number monotonicity; restore builds a forward version.
- **Integration/infra** (`withTestDb`): create → v1; N updates → vN with correct
  pointer; concurrent PATCH does not duplicate `versionNo` (unique index holds);
  restore semantics; RLS — a member of tenant A cannot read tenant B's versions.
- **Route tests** (`apps/web/app/api/agents/[id]/versions/*`): auth, list/get/restore,
  password-hash stripped from responses.
- **Backfill test:** seed legacy agents (no versions), run backfill, assert exactly one
  `v1` per agent with a faithful snapshot.

## 10. Risks / Open Questions

- **Storage growth:** frequent edits × large jsonb configs, now amplified because
  `file-sync`/`system` writes also create versions. The no-op guard bounds the worst
  case; add retention/pruning (e.g. keep last N + all restore points) as a follow-up.
- **File semantics (open):** `fileKeys` is versioned but the underlying S3 objects and
  embeddings are not — restoring an old `fileKeys` set that references deleted files must
  degrade gracefully (skip missing keys, surface a warning). **Decision needed:** does
  restore re-trigger embeddings sync (via the existing `sync-embeddings` path)?
- **Concurrent edits** rely on the `(agentId, versionNo)` unique index + row lock; the
  update tx must use one of them to serialize.
- **Write-role note:** all versioned writes go through `getMigrateDb()` (BYPASSRLS), so
  the tenant scoping on `agent_versions` is enforced on the *read* side by RLS (§8 step
  2) — the write side must set `tenantId` correctly from the agent row, not trust input.

## Rough sequencing

1. Schema + `versioning.ts` module + snapshot builder/applier (+ unit tests).
2. Migration + backfill.
3. Wire create/update/restore write paths transactionally.
4. Versions API routes (+ route tests).
5. History/diff UI.
6. (Phase 2) draft/publish.
