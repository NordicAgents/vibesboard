# Vibesboard — AI Agent Guidelines

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
- **AI:** OpenAI via the Vercel AI SDK (`ai` + `@ai-sdk/openai`); the runtime in `packages/ai/src/runtime.ts` reads `OPENAI_API_KEY` and defaults to GPT models (e.g. `gpt-5.4-nano`). There is no Anthropic SDK wired in.
- **Integrations:** Google Calendar (OAuth), WhatsApp, MCP servers

## Key Directories

- `apps/web/app/` — Next.js App Router application source (layouts, pages, `api/` route handlers, `[tenantSlug]` route group)
- `packages/` — Shared workspace packages and database adapters (e.g. `adapter-postgres`, `adapter-better-auth`, `adapter-s3`, `adapter-openai`, `ai`, `agents`)

## AI Dev Tooling (Superpowers skills)

This project's AGENTS workflow leans on [Superpowers](https://github.com/obra/superpowers) — an agentic skills framework for planning, TDD, debugging, and code review. Useful skills include:

- `superpowers:brainstorming` — use before any new feature work
- `superpowers:writing-plans` — break work into 2-5 minute tasks
- `superpowers:test-driven-development` — RED-GREEN-REFACTOR cycles
- `superpowers:systematic-debugging` — root-cause analysis workflows
- `superpowers:subagent-driven-development` — parallel agent execution
- `superpowers:verification-before-completion` — confirm fixes are real
- `superpowers:finishing-a-development-branch` — branch cleanup workflow
- `superpowers:using-git-worktrees` — isolated parallel development

Superpowers is no longer vendored in this repo. The `superpowers` git submodule (formerly at `.claude/plugins/superpowers`) was removed (commit "chore: remove superpowers git submodule"); there is no `.gitmodules`, and `.claude/plugins/` is empty. So there is no `git submodule update --init` / `--remote` step for it, and no in-repo update path.

**Needs confirmation:** the exact mechanism that now provides these skills (e.g. a globally installed Claude Code plugin / marketplace install vs. the harness loading them at session start) is not determinable from the repository contents.

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

PRs to `dev`/`main` run these workflows (each on `ubuntu-latest`, Node 22, pnpm via `pnpm/action-setup@v4`):

- **Lint** (`.github/workflows/ci-lint.yml`, "Lint & Format") — `pnpm lint` + `pnpm format:check`. Note: `pnpm lint` is `pnpm -r lint`, and only `apps/web` defines a `lint`/`format:check` script, so coverage is effectively the web app.
- **Type-check** (`.github/workflows/ci-typecheck.yml`, "Type Check") — `pnpm type-check` (TypeScript strict mode, `tsc --noEmit` per package). **Warning:** this job sets `continue-on-error: true`, so a type-check failure does NOT fail the workflow and cannot block a merge today.
- **Tests** (`.github/workflows/ci-test.yml`, "Tests") — `pnpm test` (`pnpm -r --if-present test`, Node built-in test runner). The workflow first brings up Postgres + MinIO via `docker-compose.dev.yml`, bootstraps the MinIO bucket, and runs `pnpm db:migrate` before tests. Packages without a `test` script are skipped.
- **Build** (`.github/workflows/ci-build.yml`, "Build") — `pnpm build` (Next.js production build of `apps/web`) using `NEXT_PUBLIC_*` values from `STAGING_*` secrets.
- **Security** (`.github/workflows/security.yml`, "Security & Quality", on PR and push to `dev`/`main`) — Semgrep SAST + Trivy filesystem vulnerability scan (CRITICAL,HIGH) + Lizard complexity (CCN 15).

Deployment to Cloud Run is handled separately by `.github/workflows/deploy-cloudrun.yml` on push to `dev`/`main` (migrate then build/push image and deploy via Workload Identity Federation).
