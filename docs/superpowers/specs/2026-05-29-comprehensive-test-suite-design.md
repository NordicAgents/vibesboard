# Comprehensive Test Suite — Design Spec

- **Date:** 2026-05-29
- **Branch:** `test/comprehensive-suite` (worktree off `dev`)
- **Status:** Approved — implementing

## 1. Context & Current State

Vibesboard is a multi-tenant AI agent platform (Next.js 16 / React 19 web app + 20
workspace packages). It is **not** untested today:

- **~73 existing test files** across most packages and `apps/web`.
- Convention: **Node's built-in test runner** — `node --experimental-strip-types
  --conditions react-server --test [--experimental-test-isolation=none] '…'`.
- Real-infra harness: `withTestDb()` in `@vibesboard/adapter-postgres/test-utils`
  gives per-schema Postgres isolation (admin/`vibesboard_migrate` + app/`vibesboard_app`
  roles, RLS GUCs); Postgres (pgvector) + MinIO via `docker-compose.dev.yml`; wired in
  `.github/workflows/ci-test.yml`.
- Assertions: `node:assert` / `node:assert/strict`. Mocks: manual `globalThis.fetch`
  reassignment (no `t.mock`). Workspace packages export raw `./src/*.ts`; tests import
  with explicit `.ts` extensions. `server-only` is imported widely (needs the
  `react-server` condition or it throws).

### Gaps this effort closes

- **No E2E / browser tests** at all.
- Packages with **no `test` script**: `adapter-openai`, `contracts`, `integrations`,
  `retrieval`, `utils` (some have a stray test file but no runner wiring).
- Thin coverage in large areas — `apps/web` has 362 ts/tsx files vs ~17 test files
  (esp. `app/api/**` route handlers, server actions, lib utilities).
- No coverage reporting.

## 2. Goals & Non-Goals

**Goals**

1. Migrate the entire suite to **Vitest** (single runner) and add **Playwright** for E2E.
2. Comprehensive coverage per package: **unit, integration, infra, regression**, plus
   **Playwright E2E / feature-flow** tests for the web app.
3. Coverage **reporting** in CI (no hard gate yet — ratchet later).
4. Keep every step green; land via PR into `dev`.

**Non-Goals**

- No hard coverage threshold enforced in CI (this round).
- No rewrite of application code except where a module is untestable as written
  (kept minimal and called out).
- Exhaustive 100% coverage of all 362 web files is aspirational; we prioritize by risk
  (tenant isolation, auth, RAG, API routes, billing/usage).

## 3. Locked Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Runner | **Migrate everything to Vitest** + Playwright for E2E |
| Sequencing | **Pilot slice first, then fan out** (review gate after pilot) |
| Coverage | **Report only**, no hard gate yet (Vitest v8 coverage) |
| Branch/PR | **Worktree off `dev`**, open PR into `dev` at end |
| E2E model | **Stub the model at the network boundary** (deterministic, CI-safe) |

## 4. Test Taxonomy → Concrete Targets

- **Unit** (deps mocked / pure): `utils` (sanitize, general, fetch-with-retry),
  `contracts` (zod/types), `policy` permissions, `ai` access-gate crypto + prompt/
  context builders, `agents` config/validation, `adapter-openai` fetch wrappers
  (mock `globalThis.fetch`), webhook signature verification, web `lib/*` helpers.
- **Integration** (real Postgres via `withTestDb`, real MinIO): `adapter-postgres`,
  `agents`, `tenants`, `data`, `scheduling`, `booking-enquiries`, `channel-*`,
  `ai` rag-store/file-admin, `adapter-better-auth` flows, `adapter-s3` vs MinIO, and
  web `app/api/**` route handlers invoked directly.
- **Infra**: migrations apply cleanly into a fresh schema; RLS coverage (every
  tenant-scoped table has policies); pgvector present; MinIO bucket reachable; env
  wiring matches `ci-test.yml`. (Extends existing `migrations`/`rls-coverage`/
  `schema-integrity` tests.)
- **Regression / invariants**: characterization tests for security-critical and
  previously-fragile paths — **tenant isolation must never leak**, access-gate rejects
  wrong password, idempotency keys dedupe, disabled-user enforcement, webhook
  signature rejection. New bug-specific tests land here going forward.
- **E2E / feature flows (Playwright)**: sign-in/sign-up (email+password, magic link),
  agent create/config, agent chat (model stubbed), RAG file upload, public widget chat,
  admin panel, settings/team invite, usage page.

## 5. Architecture

### 5.1 Vitest configuration

- Root `vitest.config.ts` (workspace/projects) + minimal per-package config where a
  package needs special env (DB, MinIO) vs pure-unit.
- **`resolve.alias` maps `server-only` → a no-op stub** (`test/stubs/empty.ts`) so any
  module importing it loads cleanly without the `react-server` condition. Also alias
  `client-only` for safety. (Belt-and-suspenders: also set `resolve.conditions` /
  `ssr.resolve.conditions` to include `react-server`.)
- `pool: 'forks'`, `isolate: true` (per-file isolation). DB tests already self-isolate
  per schema, so this is safe; concurrency is capped to keep Postgres connections sane.
- TS handled by Vite/esbuild; `.ts` import specifiers and workspace `src/*.ts` exports
  resolve natively.
- `apps/web` config adds the `@/*` path alias and (where needed) `jsdom` environment
  for component/DOM tests; server/route tests stay in the node environment.

### 5.2 Shared test helpers (`test/` or `packages/*/src/__tests__/helpers`)

- Re-export `withTestDb` and add ergonomic seeders (tenant + user + agent factories).
- **OpenAI stub**: a helper that swaps `globalThis.fetch` (and/or the Vercel AI SDK
  boundary) to return canned completions/embeddings deterministically.
- **MinIO/S3 helper**: ensures the bucket and bakes `S3_*` test defaults
  (`localhost:9000`, `vibesboard`/`vibesboard`, bucket `vibesboard-files`).
- **Env defaults**: a setup file that sets DB/S3 defaults when unset (mirrors
  `ci-test.yml`) so tests run locally without manual exports.

### 5.3 Playwright

- `apps/web/playwright.config.ts`: `webServer` boots the Next app against the dev
  Postgres/MinIO with a **seeded** tenant + test user (reuse seed script / e2e
  accounts). The OpenAI call is intercepted (route mock or a test-only completion
  endpoint flag) to return deterministic replies. Optional `RUN_LIVE_LLM=1` escape
  hatch for local-only real-model runs; CI stays stubbed.

### 5.4 Coverage & CI

- Vitest v8 coverage (`@vitest/coverage-v8`), reported as a CI artifact / summary —
  **no failing threshold** yet.
- Update `.github/workflows/ci-test.yml` to run Vitest; add a Playwright job (installs
  browsers, brings up services, seeds, runs E2E, uploads the HTML report).

## 6. Workflow / Orchestration

Implemented as a multi-phase agent workflow ("audit/pilot → fan out → verify").

- **Phase 0** — Worktree + `bun install` + **green baseline** of existing tests. *(done)*
- **Phase 1** — Foundation: Vitest config + shared helpers + `server-only` stub +
  Playwright skeleton; migrate **one pilot package** end-to-end (existing tests → Vitest,
  plus new unit/integration coverage). **Review gate** — user confirms the pattern.
- **Phase 2** — Fan out: one agent per package + `apps/web`. Each agent (a) migrates that
  package's existing tests to Vitest, (b) adds missing unit/integration/infra/regression
  tests, then (c) **runs that package's tests and only returns once green**. Files are
  disjoint per package, so agents run concurrently in the shared worktree.
- **Phase 3** — Playwright E2E + feature-flow specs (model stubbed).
- **Phase 4** — Coverage reporting + CI wiring; run the **full** suite; fix stragglers.
- **Phase 5** — Commit, push, open PR into `dev`.

### Parallelism model

- Max concurrency per the workflow runner; one agent owns one package's files.
- Every fill/migrate agent **verifies by running its package's tests** before returning;
  failures loop back for repair. A final full-suite run is the integration gate.

## 7. Risks & Guardrails

1. **Tests that don't actually pass are worse than none** → every agent runs its package
   tests pre-return; Phase 4 runs the whole suite.
2. **Real-service tests need Docker up** → Postgres + MinIO confirmed healthy; helpers
   bake sane localhost defaults.
3. **`server-only` throw under Vitest** → aliased to a no-op stub.
4. **AsyncLocalStorage / shared singletons** (the reason for `isolation=none`) → Vitest
   per-file isolation preserves in-file ALS chains; DB self-isolation avoids cross-file
   bleed.
5. **Don't regress the 73 passing tests** → per-package green-before/green-after.
6. **Live-server web integration tests** → either point Playwright's `webServer` at them
   or convert to in-process handler invocation; never leave them silently failing.
7. **No real OpenAI in CI** → stubbed at the network boundary; live runs are opt-in.

## 8. Success Criteria

- Single runner (Vitest) green across all packages + `apps/web`; Playwright E2E green
  against a seeded local app with the model stubbed.
- Every package has a `test` script and meaningful unit + (where relevant) integration/
  infra/regression coverage.
- Coverage reported in CI (no gate). PR opened into `dev` with a clear summary.
