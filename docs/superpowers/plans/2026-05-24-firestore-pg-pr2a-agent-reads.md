# Firestore→Postgres PR 2a: Core Agent Reads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Migrate the core agent read/CRUD surface off Firestore: `packages/agents/src/server.ts` (getAgentForUser/ForMember/ById/BySlug/NamesByTenant) and `apps/web/app/api/agents/[id]/route.ts` (single-agent GET/PATCH/DELETE). Foundation for the rest of Phase 2 (public pages, links) and Phase 4 (chat).

**Architecture:** Extract #170's `toAgentRecord(row, tenantSlug)` (in `api/agents/route.ts`) into a shared `agentRowToVibeAgent(row, tenantSlug)` in `packages/agents/src/db.ts`. Rewrite `server.ts` reads as Drizzle queries on the `agents` table, **joining `tenants` for the denormalized `tenantSlug`**. The route stays thin. `getMigrateDb()` (BYPASSRLS; routes/callers authorize).

**Tech Stack:** TS ESM, Drizzle, `node:test` + `withTestDb`, pnpm. Postgres running.

**Critical schema facts (`schema/agents.ts`):** agents columns are `id, tenantId, userId, name, slug, instructions, mode, allowAnonymous, accessPasswordHash, greetingText, quickSuggestionsMode, quickSuggestionsCount, tools(jsonb), fileKeys(jsonb), handoffTargets(jsonb), collectionFields(jsonb), maxResponses, maxAgentResponses, totalResponseCount, googleReviewEnabled, googlePlaceId, retrievalStrategy, lastEmbeddingsSyncAt, schedulingConfig(jsonb), notificationConfig(jsonb), bookingConfig(jsonb), dataConfig(jsonb), calendarAvailabilityConfig(jsonb), createdAt, updatedAt`.
- **`agentUrl` in the VibeAgent shape maps to the `slug` column.**
- **`accessPassword` maps to `accessPasswordHash`.**
- **`sourceUrls` and `domain` do NOT exist as columns** — they're legacy Firestore fields. Omit them from any Drizzle insert/update; the mapper returns them as `undefined`/`null` for compatibility but never writes them.

**Deferred:** `disableAgentsForConnection` in `server.ts` (jsonb nested-field update, only called from the calendar-connection-delete flow which is still Firestore) → **Phase 6 (scheduling)**. Leave it on Firestore for now (server.ts keeps the `adminDb` import solely for this one function; note it).

---

## Task 1: Shared agent-row mapper + migrate `server.ts` reads (TDD)

**Files:** Modify `packages/agents/src/db.ts` (add `agentRowToVibeAgent`); Modify `packages/agents/src/server.ts`; Test `packages/agents/src/__tests__/server.test.ts` (new — confirm `packages/agents` has a `test` script like sibling packages; if not, add `"test": "node --experimental-strip-types --test 'src/__tests__/**/*.test.ts'"` to `packages/agents/package.json`).

- [ ] **Step 1: Add `agentRowToVibeAgent` to `db.ts`** — extract from `toAgentRecord` (in `apps/web/app/api/agents/route.ts`), typed:

```ts
import type { agents as agentsTableType } from '@vibesboard/adapter-postgres/schema'

/** Map a Postgres agents row (+ the tenant's slug) to the VibeAgent shape. */
export const agentRowToVibeAgent = (
  row: typeof agentsTableType.$inferSelect,
  tenantSlug: string,
): VibeAgent => ({
  id: row.id,
  userId: row.userId ?? '',
  tenantId: row.tenantId,
  tenantSlug,
  name: row.name,
  instructions: row.instructions,
  fileKeys: row.fileKeys ?? [],
  agentUrl: row.slug,
  tools: row.tools ?? [],
  allowAnonymous: row.allowAnonymous ?? false,
  accessPassword: row.accessPasswordHash ?? null,
  greetingText: row.greetingText ?? null,
  mode: row.mode ?? 'provider',
  maxResponses: row.maxResponses ?? null,
  maxAgentResponses: row.maxAgentResponses ?? null,
  totalResponseCount: row.totalResponseCount ?? 0,
  quickSuggestionsMode: row.quickSuggestionsMode ?? 'off',
  quickSuggestionsCount: row.quickSuggestionsCount ?? 4,
  sourceUrls: [],
  lastEmbeddingsSyncAt: row.lastEmbeddingsSyncAt?.toISOString() ?? null,
  googleReviewEnabled: row.googleReviewEnabled ?? false,
  googlePlaceId: row.googlePlaceId ?? null,
  domain: null,
  retrievalStrategy: row.retrievalStrategy ?? 'direct',
  notificationConfig: row.notificationConfig ?? undefined,
  handoffTargets: row.handoffTargets ?? [],
  collectionFields: row.collectionFields ?? undefined,
  schedulingConfig: row.schedulingConfig ?? undefined,
  dataConfig: row.dataConfig ?? undefined,
  calendarAvailabilityConfig: row.calendarAvailabilityConfig ?? undefined,
  bookingConfig: row.bookingConfig ?? undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
```

(Refactor `api/agents/route.ts` to import + use `agentRowToVibeAgent` instead of its local `toAgentRecord`, passing the tenant slug it already fetches — keeps one mapper.)

- [ ] **Step 2: Write failing tests** `packages/agents/src/__tests__/server.test.ts` — seed a tenant + agent via `withTestDb` `adminDb`, then assert `getAgentForMember`, `getAgentById`, `getAgentBySlug`, `getAgentForUser` (userId match/mismatch), `getAgentNamesByTenant`. (Seed: insert `users`, `tenants` (slug 'acme'), `agents` row with slug 'support', userId, name 'Support'. Assert `getAgentBySlug(tenantId,'support')?.agentUrl === 'support'`, `getAgentById(agentId)?.tenantSlug === 'acme'`, `getAgentForUser` returns null on userId mismatch, `getAgentNamesByTenant(tenantId,[id])` returns `{[id]:'Support'}`.)

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Rewrite `server.ts`** reads as Postgres queries (keep `disableAgentsForConnection` on Firestore — leave its `adminDb`/`Collections` imports for that one fn only):

```ts
import { and, eq, inArray } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents as agentsTable, tenants as tenantsTable } from '@vibesboard/adapter-postgres/schema'
import { agentRowToVibeAgent } from './db.ts'
import { type VibeAgent } from '@vibesboard/contracts'
// (keep adminDb + Collections imports ONLY for disableAgentsForConnection)

async function fetchAgent(where: ReturnType<typeof and> | ReturnType<typeof eq>): Promise<VibeAgent | null> {
  const rows = await getMigrateDb()
    .select({ agent: agentsTable, tenantSlug: tenantsTable.slug })
    .from(agentsTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, agentsTable.tenantId))
    .where(where)
    .limit(1)
  if (rows.length === 0) return null
  return agentRowToVibeAgent(rows[0].agent, rows[0].tenantSlug)
}

export async function getAgentForMember(tenantId: string, agentId: string): Promise<VibeAgent | null> {
  return fetchAgent(and(eq(agentsTable.id, agentId), eq(agentsTable.tenantId, tenantId)))
}

export async function getAgentForUser(tenantId: string, agentId: string, userId: string): Promise<VibeAgent | null> {
  const agent = await getAgentForMember(tenantId, agentId)
  if (!agent || agent.userId !== userId) return null
  return agent
}

export async function getAgentById(agentId: string): Promise<VibeAgent | null> {
  return fetchAgent(eq(agentsTable.id, agentId))
}

export async function getAgentBySlug(tenantId: string, slug: string): Promise<VibeAgent | null> {
  return fetchAgent(and(eq(agentsTable.tenantId, tenantId), eq(agentsTable.slug, slug)))
}

export async function getAgentNamesByTenant(tenantId: string, agentIds: string[]): Promise<Record<string, string>> {
  if (!agentIds.length) return {}
  const rows = await getMigrateDb()
    .select({ id: agentsTable.id, name: agentsTable.name })
    .from(agentsTable)
    .where(and(eq(agentsTable.tenantId, tenantId), inArray(agentsTable.id, agentIds)))
  const names: Record<string, string> = {}
  for (const r of rows) names[r.id] = r.name
  return names
}

// disableAgentsForConnection: UNCHANGED (still Firestore) — migrates in Phase 6.
```

- [ ] **Step 5: Run tests + type-check** — pass + clean. Note `agent.userId` is `''` when the column is null (anonymous/system agents) — getAgentForUser's mismatch check still works.

- [ ] **Step 6: Commit** — `feat(agents): core agent reads on Postgres + shared agentRowToVibeAgent mapper`

---

## Task 2: Migrate `apps/web/app/api/agents/[id]/route.ts` (GET/PATCH/DELETE)

**Files:** Modify the route.

- **GET:** already calls `getAgentById` (now Postgres) — no change beyond confirming. Remove unused `adminDb`/`mapAgentDoc` imports.
- **PATCH:** keep validation (webhook SSRF, handoff self-ref, handoff-target-same-tenant via `getAgentById`, `canEditAgent`). Replace the Firestore `docRef.update(updates)` with a Drizzle `update(agents).set(...).where(eq(agents.id, id))`. **Build the `set` object from only real columns** — map `payload` fields to columns; **DO NOT include `sourceUrls` or `domain`** (no columns). `updatedAt: new Date()`. Re-fetch via `getAgentById(id)` and return `{ agent }`.
- **DELETE:** keep `canEditAgent` + S3 `deleteFile(fileKeys)` cleanup. Replace `recursiveDelete` with `getMigrateDb().delete(agents).where(eq(agents.id, id))` — **verify child tables (conversations, files, hooks, vectors) reference `agents.id` with `onDelete: cascade`** before relying on this (grep `references(() => agents` for cascade; if any child lacks cascade, delete those rows explicitly first).

Verify type-check + no Firestore in the route. Commit: `feat(agents): single-agent GET/PATCH/DELETE on Postgres`.

---

## Task 3: Verify
- [ ] `pnpm --filter @vibesboard/agents test` (+ tenants) pass; `pnpm type-check` clean; `pnpm lint` 0 errors.
- [ ] `grep -rn "adminDb\|firebase-admin/firestore" "apps/web/app/api/agents/[id]" packages/agents/src/server.ts` → only the `disableAgentsForConnection` usage remains in server.ts (documented).
- [ ] **Staging e2e:** create an agent (POST /api/agents — already Postgres), then `GET /api/agents/[id]` (200, full shape, agentUrl=slug), `PATCH` (rename + toggle a tool → 200, persisted), `DELETE` (204, row + children gone on VM). Confirm the agent appears on the dashboard agents list.

## Notes
- The agents schema has NO `sourceUrls`/`domain` columns — the mapper returns `[]`/`null`; PATCH must not write them (would throw "column does not exist").
- `canEditAgent` (`@vibesboard/agents/permissions`) — confirm it's already on Postgres/pure (it takes ids); if it reads Firestore, migrate it as part of Task 2.
- `disableAgentsForConnection` stays Firestore until Phase 6; server.ts keeps `adminDb` import for it only.
