# Adapter-Postgres Foundation — Design Spec

**Status:** Approved 2026-05-17 (sub-project #1 of self-host migration)
**Sub-project of:** Replace Firebase with self-hosted Postgres + S3 + Auth
**Audience:** Engineer implementing this with zero context for the codebase

---

## Context

Vibesboard currently runs entirely on Firebase: Firestore for all app data, Firebase Auth for sign-in, GCS for files, Cloud Functions for triggers, and `firestore.rules` for multi-tenant isolation. Stripe billing layered on top of this provides plan gating and metered overage.

The decision has been made to fork the codebase to a **fully self-hostable stack**: Postgres (with pgvector) + S3-compatible storage + a self-hosted auth library. Stripe billing is being removed entirely — self-host has no notion of paid plans.

This is the first of six sub-projects:

| # | Sub-project | Status |
|---|---|---|
| **1** | **adapter-postgres foundation** (this spec) | **designing** |
| 2 | Auth swap (Firebase Auth → Better Auth) | not started |
| 3 | Storage swap (GCS → S3-compatible) | not started |
| 4 | Data swap (port all Firestore callsites) | not started |
| 5 | Strip Stripe + simplify policy package | not started |
| 6 | Deployment + ops (self-host docker-compose, backups) | not started |

Sub-project #1 is **pure foundation**: it adds a new `@vibesboard/adapter-postgres` package with full schema, RLS-enforced multi-tenant isolation, local Docker dev setup, and a tested ephemeral-DB pattern — **without touching any existing callsite**. The package is mergeable on its own; the existing app continues to use Firebase unmodified. Every later sub-project depends on this one.

### Approved design decisions

1. **Pure self-host fork** — single supported stack. Firebase code will be deleted in sub-project #4. Production data migration is a separate effort kicked off after sub-project #6.
2. **Proper relational redesign** — real FKs, junction tables, no Firestore mirroring. jsonb only for config-shaped data that's read/written as a unit.
3. **Row-Level Security with per-request `SET LOCAL`** — DB-enforced tenant isolation. App code stays simple.
4. **Pure foundation scope** — no app callsites touched in this sub-project.

---

## Goal

Add `@vibesboard/adapter-postgres` — a workspace package that provides the Postgres data plane (schema, migrations, connection client, RLS plumbing, tenant context helper, ephemeral-DB testing utilities) for every later sub-project to consume.

### Non-goals (explicit)

- **Not** porting any existing callsite from Firestore to Postgres (that's sub-project #4).
- **Not** building auth/sessions logic (that's sub-project #2). Only minimal stub `users`/`sessions` tables ship here.
- **Not** implementing S3 storage (sub-project #3).
- **Not** removing any Firebase code, rules, indexes, or Cloud Functions (sub-project #4).
- **Not** removing Stripe code (sub-project #5).
- **Not** building production deploy story or backup tooling (sub-project #6).
- **Not** writing the production data migration script.

---

## Architecture

### Package layout

New package at `packages/adapter-postgres/`, modeled on the existing `adapter-firebase` pattern: subpath-based imports, `server-only` enforced, no client-bundle path.

```
packages/adapter-postgres/
  package.json                       # name: @vibesboard/adapter-postgres
  drizzle.config.ts                  # points at ./src/schema, ./drizzle migrations dir
  docker/
    init.sql                         # extensions + role bootstrap (only raw SQL we ship)
  drizzle/                           # generated SQL migrations (committed)
    0000_initial_schema.sql
    meta/
  src/
    index.ts                         # barrel comment only — force subpath imports
    client.ts                        # postgres.js + Drizzle client; transaction-wrapped queries
    schema/
      index.ts                       # `export * from './tenants'; …`
      tenants.ts                     # tenants, tenant_members, invitations
      users.ts                       # users, sessions (minimal stubs)
      agents.ts                      # agents, agent_links, hooks, hook_jobs
      conversations.ts               # conversations, messages, conversation_feedback, notifications
      files.ts                       # files, file_chunks
      vectors.ts                     # embeddings (pgvector polymorphic)
      scheduling.ts                  # calendar_connections, bookings, booking_enquiries
      channels.ts                    # whatsapp_*, instagram_*, chatwoot_*
      policy.ts                      # feature_flags, tenant_feature_toggles, usage_counters
      data.ts                        # data_connections, data_action_logs
      branding.ts                    # tenant_branding, platform_branding
    tenant-context.ts                # AsyncLocalStorage helper: setTenantContext, withTenant, getContext
    rls.ts                           # SQL helpers that set/clear app.current_* GUCs inside transactions
    types.ts                         # re-exports inferred Drizzle types (Tenant, Message, etc.)
    test-utils.ts                    # withTestDb ephemeral-schema helper
    seed.ts                          # pnpm db:seed entry point
    __tests__/
      migrations.test.ts
      rls-coverage.test.ts
      rls-behavior.test.ts
      schema-integrity.test.ts
      vectors.test.ts
      tenant-context.test.ts
```

### Subpath import contract

```ts
import { db }                         from '@vibesboard/adapter-postgres/client'
import { messages, tenants, type Message } from '@vibesboard/adapter-postgres/schema'
import { withTenant, getContext }     from '@vibesboard/adapter-postgres/tenant-context'
import { withTestDb }                 from '@vibesboard/adapter-postgres/test-utils'
```

The `index.ts` is comment-only, mirroring `adapter-firebase/src/index.ts`. Any consumer importing from the bare package name gets a helpful comment, not server code, and not client code.

### Tech stack (no further questions — decisions locked)

| Concern | Choice | Rationale |
|---|---|---|
| ORM / query builder | **Drizzle** | TypeScript-first, schema-in-TS, real migrations, lightweight runtime, close to SQL |
| Postgres driver | **`postgres`** (postgres.js) | Faster than `pg`, modern API, plays well with serverless |
| Migration tool | **Drizzle Kit** (`drizzle-kit generate` / `migrate`) | Bundled with ORM, no third tool |
| Primary keys | **UUID v7** via `uuidv7` npm package | Sortable, monotonic, app-generated (no `pgcrypto` dependency) |
| Naming | **snake_case in DB, camelCase in TS** via Drizzle's column-name mapping | SQL idiomatic where it matters, TS idiomatic where it matters |
| Timestamps | **`timestamptz`** | JS `Date` in TS, UTC stored, single canonical form |
| Vector storage | **pgvector** in same Postgres, one polymorphic `embeddings` table | One DB to operate; polymorphic source via `(source_type, source_id)` |
| Full-text search | **`tsvector` + GIN index** on `embeddings.content_tsv` | Enables hybrid BM25 + vector retrieval |
| Migration strategy | **Forward-only** — no down migrations | Same as Firestore today (no schema rollbacks possible there either) |
| Test runner | **Node's built-in `node --test`** | Matches existing `pnpm test` in CLAUDE.md |
| Local dev | **Docker Compose** (`pgvector/pgvector:pg16` + adminer) | One command setup, parity with prod |

### Data layer model

```
┌────────────────────────────────────────────────────────────────────┐
│ Application (Next.js, worker, scripts) — uses vibesboard_app role  │
│                                                                    │
│   import { db } from '@vibesboard/adapter-postgres/client'         │
│                                                                    │
│   withTenant({ tenantId, userId, isSuperAdmin }, async () => {     │
│     await db.select().from(messages).where(...)  ← any call here   │
│   })                                              opens a transaction│
└────────────────────────────────────────────────────────────────────┘
                              │
                       ALS context
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  client.ts transaction wrapper                                     │
│    BEGIN;                                                          │
│    SET LOCAL app.current_tenant_id = '<uuid>';                     │
│    SET LOCAL app.current_user_id   = '<uuid or empty>';            │
│    SET LOCAL app.is_super_admin    = 'false';                      │
│    <actual query>                                                  │
│    COMMIT;                                                         │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Postgres (vibesboard_app role, RLS enforced)                      │
│    Every multi-tenant table has a policy that filters on           │
│    current_setting('app.current_tenant_id', true)::uuid            │
│    OR current_setting('app.is_super_admin', true) = 'true'         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Schema

### Strategy

Five rules govern every table definition:

1. **Every multi-tenant table has `tenant_id uuid not null references tenants(id) on delete cascade`.** No exceptions. RLS depends on this; account deletion stays simple.
2. **jsonb policy:** use jsonb for config-shaped data that's read/written as one unit and never queried internally (e.g. `agents.scheduling_config`, `agents.notification_config`, `hooks.payload_template`). Use real columns for anything you'd filter, sort, or aggregate on.
3. **No Stripe leftovers.** `plan_templates`, `tenant_subscriptions`, `usage_logs`, `usage_rollups`, `invite_codes` from `firestore-types.ts` are dropped. `tenants.plan_id` becomes a nullable text column defaulting to `'self_hosted'` (kept so future self-hosters can implement local feature gating if they want, but not enforced).
4. **Indexes are explicit and committed.** Every FK gets an index. Hot paths (`messages(conversation_id, created_at desc)`, `embeddings(tenant_id, source_type, source_id)`) get composite indexes.
5. **Vector storage is one polymorphic table** — `embeddings(id, tenant_id, source_type, source_id, chunk_index, content, content_tsv, embedding vector(1536), created_at)` — covers file chunks and conversation chunks today, extensible to future RAG sources.

### Representative tables (full schema in implementation plan)

```ts
// schema/tenants.ts
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['active','suspended','trial'] }).notNull().default('active'),
  planId: text('plan_id').notNull().default('self_hosted'),
  branding: jsonb('branding').$type<TenantBranding>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tenantMembers = pgTable('tenant_members', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:   uuid('user_id').notNull().references(() => users.id,    { onDelete: 'cascade' }),
  role: text('role', { enum: ['SUPER_ADMIN','TENANT_ADMIN','MEMBER'] }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  byUser: index('tenant_members_user_idx').on(t.userId),
}))
```

```ts
// schema/agents.ts
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  mode: text('mode', { enum: ['provider','collector'] }).notNull(),
  systemPrompt: text('system_prompt').notNull(),
  schedulingConfig:   jsonb('scheduling_config').$type<AgentSchedulingConfig>(),
  notificationConfig: jsonb('notification_config').$type<AgentNotificationConfig>(),
  bookingConfig:      jsonb('booking_config').$type<AgentBookingConfig>(),
  dataConfig:         jsonb('data_config').$type<AgentDataConfig>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSlug: uniqueIndex('agents_tenant_slug_idx').on(t.tenantId, t.slug),
}))
```

```ts
// schema/conversations.ts
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  agentId:  uuid('agent_id').notNull().references(() => agents.id,    { onDelete: 'cascade' }),
  externalUserId: text('external_user_id'),
  status: text('status', { enum: ['open','resolved','snoozed'] }).notNull().default('open'),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byAgent: index('conversations_agent_idx').on(t.tenantId, t.agentId, t.updatedAt),
}))

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user','assistant','system','tool'] }).notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls').$type<ToolCall[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byConv: index('messages_conv_created_idx').on(t.conversationId, t.createdAt),
}))
```

```ts
// schema/vectors.ts
export const embeddings = pgTable('embeddings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sourceType: text('source_type', { enum: ['file_chunk','conversation_chunk'] }).notNull(),
  sourceId: uuid('source_id').notNull(),                 // polymorphic — FK enforced at app layer
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  contentTsv: tsvector('content_tsv'),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byTenantSource: index('embeddings_tenant_src_idx').on(t.tenantId, t.sourceType, t.sourceId),
  hnsw: index('embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  tsvIdx: index('embeddings_tsv_idx').using('gin', t.contentTsv),
}))
```

### Full entity coverage

The complete schema covers every entity in `packages/contracts/src/firestore-types.ts` except the Stripe-related ones. Implementation plan enumerates table-by-table from that file. Entities being intentionally dropped:

- `PlanTemplateDocument` — Stripe plans
- `TenantSubscription` (embedded in tenant) — Stripe subscription state
- `UsageLogDocument` — Stripe metered overage logs
- `UsageRollupDocument` — Stripe metered overage rollups
- `InviteCodeDocument`, `InviteCodeRedemption` — referral-credit-on-Stripe-plan system
- `ConversationRefDocument` — Firestore denormalization helper; redundant with JOINs

Entities being simplified:

- `UserAgentUsage`, `UserUsage` — kept as a single `usage_counters(tenant_id, agent_id, period_start, message_count)` table, with **no** plan-limit enforcement. Self-hosters can add their own gating if they want.
- `TenantSubscription` removed from `tenants` row entirely.

### Stub-only tables for sub-project #2

`users` and `sessions` ship as **minimal stubs**: just enough for FK targets in `tenant_members`, `agents`, etc. to compile. Sub-project #2 (auth swap) extends them with whatever columns Better Auth needs.

```ts
// schema/users.ts (stubs)
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  imageUrl: text('image_url'),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index('sessions_user_idx').on(t.userId),
}))
```

---

## Row-Level Security

### Two-role model

| Role | Used by | Bypasses RLS? | Connection string env |
|---|---|---|---|
| `vibesboard_app` | App (Next.js, worker), `pnpm db:seed` | **No.** All queries subject to RLS. | `DATABASE_URL` |
| `vibesboard_migrate` | Drizzle Kit migrations, admin scripts, `withTestDb` setup | **Yes** (`BYPASSRLS`). | `DATABASE_MIGRATE_URL` |

The app's connection literally cannot bypass RLS regardless of bugs. There is no `SET ROLE` escape path.

### Bootstrap SQL (only raw SQL we ship)

`packages/adapter-postgres/docker/init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE ROLE vibesboard_migrate WITH LOGIN PASSWORD 'vibesboard_migrate' BYPASSRLS;
CREATE ROLE vibesboard_app     WITH LOGIN PASSWORD 'vibesboard_app';

GRANT ALL ON SCHEMA public TO vibesboard_migrate;
GRANT USAGE ON SCHEMA public TO vibesboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibesboard_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vibesboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibesboard_migrate IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO vibesboard_app;
```

### Per-request context

Every DB query runs inside a transaction with three `SET LOCAL` GUCs:

```sql
SET LOCAL app.current_tenant_id = '<uuid>';
SET LOCAL app.current_user_id   = '<uuid or empty string>';
SET LOCAL app.is_super_admin    = 'false';
```

`SET LOCAL` is transaction-scoped, so connection-pool reuse is safe.

**Operational gotcha (documented, not code):** if PgBouncer is added in production, it MUST be configured in transaction-pooling mode, not session-pooling — otherwise `SET LOCAL` semantics break. Out of scope for sub-project #1; flagged here for sub-project #6.

### Tenant context helper

```ts
// adapter-postgres/src/tenant-context.ts
import { AsyncLocalStorage } from 'node:async_hooks'

export type TenantContext = {
  tenantId: string
  userId: string | null
  isSuperAdmin: boolean
}

const als = new AsyncLocalStorage<TenantContext>()

export function getContext(): TenantContext | undefined { return als.getStore() }

export async function withTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn)
}
```

The Drizzle client (`client.ts`) reads the ALS context, opens a transaction, sets the three GUCs, runs the query, commits. Callsites just call `db.select().from(messages)` — they don't know about the transaction wrapping.

Middleware in `apps/web` is the only thing that calls `withTenant(...)`. Every server action and API route inherits context via ALS. (Sub-project #2 wires the middleware. Sub-project #1 ships the helper.)

### Representative RLS policy

```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_tenant_isolation ON messages
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
```

The `, true` second arg to `current_setting` returns `NULL` if the var is unset — query without context sees zero rows (not an error). Fail closed.

`users` and `sessions` have parallel policies keyed on `current_user_id` instead of `current_tenant_id`.

### Anonymous public-agent access pattern

A public agent receives a chat from a visitor with no account:

1. Public route resolves the agent by slug → gets the agent's `tenant_id`.
2. Route calls `withTenant({ tenantId, userId: null, isSuperAdmin: false }, async () => { ... })`.
3. Inside, the route reads the agent and writes conversations/messages tagged with that `tenant_id`. RLS allows it because `tenant_id` matches.
4. Route **cannot** read users, sessions, or any other tenant's data — RLS blocks it.

No special "anonymous mode" needed. Model: anonymous = "tenant-scoped, no user." RLS handles it naturally.

### Coverage enforcement

A CI test (`rls-coverage.test.ts`) introspects `pg_class` and `pg_policies` and asserts every public table has RLS enabled and at least one policy. An explicit allowlist (`RLS_EXEMPT`) in the test file handles legitimate exceptions (`drizzle_migrations`, etc.). Adding to the allowlist is a security-reviewable diff.

---

## Local development

### Docker Compose stack

`docker-compose.dev.yml` at repo root (new file):

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: vibesboard_dev
      POSTGRES_USER: vibesboard
      POSTGRES_PASSWORD: vibesboard
    ports: ['5432:5432']
    volumes:
      - vibesboard_pg:/var/lib/postgresql/data
      - ./packages/adapter-postgres/docker/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U vibesboard']
      interval: 2s
      retries: 30

  adminer:
    image: adminer:4
    ports: ['8888:8080']
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  vibesboard_pg:
```

### Env vars introduced

Added to `.env.example`:

```bash
DATABASE_URL=postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev
DATABASE_MIGRATE_URL=postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev
```

### Top-level scripts (added to root `package.json`)

| Script | What it does |
|---|---|
| `pnpm db:up` | `docker compose -f docker-compose.dev.yml up -d postgres`, wait for healthy |
| `pnpm db:down` | `docker compose -f docker-compose.dev.yml down` (preserves volume) |
| `pnpm db:reset` | drop volume, re-up, re-migrate, re-seed (dev only; prompts for confirmation) |
| `pnpm db:migrate` | `drizzle-kit migrate` using `DATABASE_MIGRATE_URL` |
| `pnpm db:generate` | `drizzle-kit generate` — diff TS schema → emit SQL migration file |
| `pnpm db:studio` | `drizzle-kit studio` — browse the DB in Drizzle's GUI |
| `pnpm db:seed` | run `packages/adapter-postgres/src/seed.ts` |
| `pnpm db:setup` | composite: `db:up && db:migrate && db:seed` |

### Seed data

`packages/adapter-postgres/src/seed.ts` creates only what's needed to exercise the schema:

- One tenant: `acme` (slug `acme`)
- Two users: `admin@example.com` (TENANT_ADMIN), `member@example.com` (MEMBER)
- One agent: `acme/demo-agent`
- One conversation with three messages

No knowledge-base files, no embeddings — those need LLM and S3, neither of which is in sub-project #1.

### Ephemeral-DB testing helper

`packages/adapter-postgres/src/test-utils.ts`:

```ts
export async function withTestDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const schemaName = `test_${randomUUID().replace(/-/g, '_')}`
  const adminDb = createMigrateClient()
  await adminDb.execute(sql.raw(`CREATE SCHEMA ${schemaName}`))
  await adminDb.execute(sql.raw(`SET search_path TO ${schemaName}`))
  await runDrizzleMigrations(adminDb, schemaName)
  const appDb = createAppClient({ schemaName })
  try {
    return await fn(appDb)
  } finally {
    await adminDb.execute(sql.raw(`DROP SCHEMA ${schemaName} CASCADE`))
  }
}
```

Per-schema (not per-database) — schema creation is ~50ms vs ~2s for database creation. Tests run in parallel against one container.

---

## Testing

Six test files, all under `packages/adapter-postgres/src/__tests__/`. Wired into root `pnpm test` via the package's own `test` script. Requires the Docker Postgres from local-dev section to be running (or any reachable Postgres at `DATABASE_MIGRATE_URL`).

| Test file | What it asserts |
|---|---|
| `migrations.test.ts` | Fresh migrate from zero to head succeeds; resulting schema has no drift vs Drizzle introspection |
| `rls-coverage.test.ts` | Every public table has RLS enabled and ≥1 policy (with allowlist) |
| `rls-behavior.test.ts` | Five concrete scenarios: cross-tenant read empty, cross-tenant write fails, no context → empty, super-admin sees all, anonymous can read tenant-scoped data |
| `schema-integrity.test.ts` | FK cascades work, unique constraints fire, NOT NULL enforced, jsonb round-trips losslessly |
| `vectors.test.ts` | pgvector plumbing: insert 100 vectors across 2 tenants, kNN respects tenant scope, hybrid BM25+vector query works, HNSW index is used in EXPLAIN |
| `tenant-context.test.ts` | AsyncLocalStorage propagates through awaits, nested contexts work, parallel contexts isolated |

Quality bar: tests are mechanical and fast (<10s total for the suite). No real embeddings, no real load, no app integration — those belong to later sub-projects.

---

## Deliverables

### New files

```
docker-compose.dev.yml
packages/adapter-postgres/
  package.json
  drizzle.config.ts
  README.md
  docker/init.sql
  drizzle/0000_initial_schema.sql       (generated)
  drizzle/meta/                          (generated)
  src/index.ts
  src/client.ts
  src/tenant-context.ts
  src/rls.ts
  src/types.ts
  src/test-utils.ts
  src/seed.ts
  src/schema/index.ts
  src/schema/tenants.ts
  src/schema/users.ts
  src/schema/agents.ts
  src/schema/conversations.ts
  src/schema/files.ts
  src/schema/vectors.ts
  src/schema/scheduling.ts
  src/schema/channels.ts
  src/schema/policy.ts
  src/schema/data.ts
  src/schema/branding.ts
  src/__tests__/migrations.test.ts
  src/__tests__/rls-coverage.test.ts
  src/__tests__/rls-behavior.test.ts
  src/__tests__/schema-integrity.test.ts
  src/__tests__/vectors.test.ts
  src/__tests__/tenant-context.test.ts
```

### Modified files

- `.env.example` — adds `DATABASE_URL`, `DATABASE_MIGRATE_URL`
- `package.json` (root) — adds the 8 `db:*` scripts
- `.gitignore` — adds `**/docker-volumes/` (defensive, in case anyone overrides volume path)
- `README.md` — adds "Self-host quickstart" section pointing at Docker setup (just the new package; full self-host story comes in sub-project #6)
- `pnpm-workspace.yaml` — no change needed (already globs `packages/*`)

### Untouched (explicit)

- `firestore.rules`, `firestore.indexes.json` — sub-project #4 deletes these
- `apps/functions/**` — sub-project #4 absorbs
- `packages/adapter-firebase/**` — sub-project #4 deletes
- `packages/billing/**`, `packages/adapter-stripe/**` — sub-project #5 deletes
- Any callsite of `adminDb`, `adminAuth`, `adminStorage` — sub-project #4
- `apps/web/**` middleware/actions/routes — sub-projects #2 and #4
- `firebase.json`, `.firebaserc` — sub-project #6

---

## Success criteria

Sub-project #1 is **done** when:

1. ✅ Fresh clone → `pnpm install && pnpm db:setup` produces a running, fully migrated, seeded Postgres on a machine that has only Docker and pnpm.
2. ✅ `pnpm --filter @vibesboard/adapter-postgres test` passes — all six test files.
3. ✅ `pnpm type-check`, `pnpm lint`, `pnpm format:check` pass at repo root.
4. ✅ `pnpm --filter @vibesboard/web build` still succeeds. Sub-project #1 does not break the existing app.
5. ✅ The RLS allowlist (`RLS_EXEMPT` in `rls-coverage.test.ts`) contains only justified entries.
6. ✅ Spec doc and implementation plan exist in `docs/superpowers/`, both committed.

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Schema design has gaps surfaced only when sub-project #4 starts porting callsites | Medium | Schema is reviewed entity-by-entity against `firestore-types.ts` during the writing-plans step. Accept that 1–2 follow-up schema migrations in #4 are normal. |
| RLS `SET LOCAL` interacts badly with Drizzle transactions under load | Low | `tenant-context.test.ts` parallel test catches the obvious break. Real load happens in #4. PgBouncer caveat documented for #6. |
| pgvector not present on self-hoster's Postgres | High at first | Docker image pinned to `pgvector/pgvector:pg16`. Self-hosters using own Postgres get a loud error from migration 0000 (`CREATE EXTENSION vector` fails) plus README note. |
| Drizzle migration drift (generated migration doesn't match TS schema) | Medium | `migrations.test.ts` runs the full sequence on CI and asserts no drift. |
| AsyncLocalStorage doesn't propagate through some third-party library used later | Low | `tenant-context.test.ts` plus documented pattern: always set context in middleware, never below it. |

---

## What sub-projects #2–#6 inherit

- A working DB connection at `@vibesboard/adapter-postgres/client`
- A schema module exporting types via Drizzle's inference (e.g., `type Tenant = typeof tenants.$inferSelect`)
- A tenant-context helper for the auth middleware in #2 to populate
- An ephemeral-DB test pattern reusable in every later sub-project
- A migration workflow already part of the dev loop
