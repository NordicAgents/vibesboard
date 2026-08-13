# Vibesboard — AI Agent Guidelines

> `AGENTS.md` and `CLAUDE.md` mirror each other — edit both files together.

## Project Overview

Vibesboard is a multi-tenant AI agent platform. It allows businesses to create, configure, and deploy AI agents with features including:
- Multi-tenant workspace isolation
- RAG (Retrieval-Augmented Generation) for knowledge bases
- Calendar availability & scheduling
- WhatsApp integration
- MCP (Model Context Protocol) server support
- Agent hooks system
- Usage metering

## Tech Stack

- **Frontend:** React 19 + TypeScript on Next.js 16 (App Router); Tailwind CSS + Radix UI primitives
- **Backend:** Postgres (Drizzle ORM), Better-Auth, and S3-compatible storage (MinIO in dev)
- **AI:** Vercel AI SDK (`ai`) with OpenAI, Anthropic, and Google adapters plus NVIDIA and generic OpenAI-compatible endpoints. Workspaces can bring encrypted provider credentials and route by agent or task; `OPENAI_API_KEY`/`OPENAI_MODEL` provide the platform fallback.
- **Integrations:** Google Calendar (OAuth), WhatsApp, MCP servers

## Key Directories

- `apps/web/app/` — Next.js App Router application source (layouts, pages, `api/` route handlers, `[tenantSlug]` route group)
- `packages/` — Shared workspace packages and database adapters (e.g. `adapter-postgres`, `adapter-better-auth`, `adapter-s3`, `adapter-openai`, `ai`, `agents`)

## AI Dev Tooling

Development here historically used the [Superpowers](https://github.com/obra/superpowers) skills framework (brainstorming, planning, TDD, systematic debugging, worktree workflows). It is not vendored in this repo — install it as a Claude Code plugin if you want the same skills; the guidelines below stand on their own.

## Development Guidelines

- Always brainstorm before implementing new features
- Write tests before implementation (TDD)
- Use systematic debugging for non-obvious bugs — find root causes, don't patch symptoms
- Security is a priority — this is a multi-tenant SaaS, tenant isolation matters
- Optimize SQL queries and rely on Postgres indexes for performance

## Branching & Release Strategy

- `dev` — staging environment (Cloud Run + Postgres)
- `main` — production environment
- Feature branches merge to `dev` via PR
- `dev` merges to `main` for production releases
- Releases are automated on push to `main` by release-please (`googleapis/release-please-action@v4`, `release-type: simple`), which reads conventional commits for version bumps and changelogs
- Commit format: `feat(scope): message`, `fix(scope): message`, `chore(scope): message`

### Merging `dev` → `main` (IMPORTANT)

**Always use "Create a merge commit" — never "Squash and merge" or "Rebase and merge" — when merging `dev` into `main`.**

Why: squash/rebase merges create new commits on `main` with different SHAs than the originals on `dev`. From git's perspective the two branches then have divergent history with overlapping content, so the next `dev` → `main` PR re-presents already-shipped work as "new on both sides" and produces phantom merge conflicts. A real merge commit preserves the parent link, so future PRs only diff the actually-new commits.

After merging `dev` → `main`, immediately back-merge `main` into `dev` to keep the branch tips aligned:

```bash
git checkout dev && git pull
git merge origin/main --no-ff -m "chore: sync main into dev after release"
git push origin dev
```

For feature → `dev` PRs, squash merge is fine (those branches are deleted after merge).

## CI Requirements

PRs to `dev`/`main` run these workflows (each on `ubuntu-latest`, Bun 1.2.18 via `oven-sh/setup-bun@v2`, Node 22):

- **Lint** (`.github/workflows/ci-lint.yml`, "Lint & Format") — `bun run lint` + `bun run format:check`. Note: `bun run lint` is `bun run --filter '*' lint`, and only `apps/web` defines a `lint`/`format:check` script, so coverage is effectively the web app.
- **Type-check** (`.github/workflows/ci-typecheck.yml`, "Type Check") — `bun run type-check` (TypeScript strict mode, `tsc --noEmit` per package). This job used to set `continue-on-error: true`, which meant a type-check failure could not block a merge; that has been removed and it now gates.
- **Tests** (`.github/workflows/ci-test.yml`, "Tests") — `bun run test:coverage` (`vitest run --coverage`, a single unified Vitest run across all workspace projects with v8 coverage; coverage is reported as an artifact and gated by a ratchet threshold in `vitest.shared.mts`). The workflow first brings up Postgres + MinIO via `docker-compose.dev.yml`, bootstraps the MinIO bucket, and runs `bun run db:migrate` before tests. Each package has its own `vitest.config.mts` (and `"test": "vitest run"`); packages without one are simply absent from the root `projects` glob.
- **E2E** (`.github/workflows/ci-e2e.yml`, "E2E") — runs **two** Playwright suites against one Postgres + MinIO stack, with the Chromium browser installed first. Both boot a deterministic mock OpenAI server plus `next dev` with `OPENAI_BASE_URL` pointed at the mock, so the model is stubbed at the network boundary.
  - `bun run test:e2e` — the specs directly under `apps/web/e2e/`; `globalSetup` seeds an E2E user/tenant.
  - `bun run test:e2e:local` — the deep suite under `apps/web/e2e/local/` (agents, chat, settings, BYO-LLM, public widget, conversations, knowledge base, sharing, admin panel, tenant flow, cross-tenant isolation). Its `globalSetup` additionally seeds an outsider account and a superadmin. See `docs/local-e2e.md` for running it locally, including the no-Docker path.
- **Build** (`.github/workflows/ci-build.yml`, "Build") — `bun run build` (Next.js production build of `apps/web`) using `NEXT_PUBLIC_*` values from `STAGING_*` secrets.
- **Security** (`.github/workflows/security.yml`, "Security & Quality", on PR and push to `dev`/`main`) — Semgrep SAST + Trivy filesystem vulnerability scan (CRITICAL,HIGH) + Lizard complexity (CCN 15).

Deployment to Cloud Run is handled separately by `.github/workflows/deploy-cloudrun.yml` on push to `dev`/`main` (migrate then build/push image and deploy via Workload Identity Federation).
