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

- **Frontend:** React + TypeScript
- **Backend:** Firebase (Firestore, Auth, Functions)
- **AI:** Anthropic Claude API
- **Integrations:** Google Calendar (OAuth), WhatsApp, MCP servers

## Key Directories

- `src/` — main application source
- `functions/` — Firebase Cloud Functions
- `docs/` — feature documentation organized by area
- `.claude/plugins/superpowers/` — Superpowers skills framework (git submodule)

## Superpowers Integration

This project uses [Superpowers](https://github.com/obra/superpowers) — an agentic skills framework that activates structured workflows for planning, TDD, debugging, and code review.

Skills are loaded automatically at session start. Key skills available:
- `superpowers:brainstorming` — use before any new feature work
- `superpowers:writing-plans` — break work into 2-5 minute tasks
- `superpowers:test-driven-development` — RED-GREEN-REFACTOR cycles
- `superpowers:systematic-debugging` — root-cause analysis workflows
- `superpowers:subagent-driven-development` — parallel agent execution
- `superpowers:verification-before-completion` — confirm fixes are real
- `superpowers:finishing-a-development-branch` — branch cleanup workflow
- `superpowers:using-git-worktrees` — isolated parallel development

To update superpowers: `git submodule update --remote .claude/plugins/superpowers`

## Development Guidelines

- Always brainstorm before implementing new features
- Write tests before implementation (TDD)
- Use systematic debugging for non-obvious bugs — find root causes, don't patch symptoms
- Security is a priority — this is a multi-tenant SaaS, tenant isolation matters
- Keep Firebase costs in mind — avoid unnecessary reads/writes

## Branching & Release Strategy

- `dev` — staging environment (Cloud Run + Firebase)
- `main` — production environment
- Feature branches merge to `dev` via PR
- `dev` merges to `main` for production releases
- Releases are auto-tagged on merge to `main` using conventional commits
- Commit format: `feat(scope): message`, `fix(scope): message`, `chore(scope): message`

### Merging `dev` → `main` (IMPORTANT)

**Always use "Create a merge commit" — never "Squash and merge" or "Rebase and merge" — when merging `dev` into `main`.**

Why: squash/rebase merges create new commits on `main` with different SHAs than the originals on `dev`. From git's perspective the two branches then have divergent history with overlapping content, so the next `dev` → `main` PR re-presents already-shipped work as "new on both sides" and produces phantom merge conflicts. A real merge commit preserves the parent link, so future PRs only diff the actually-new commits.

After merging `dev` → `main`, immediately back-merge `main` into `dev` to keep the branch tips aligned:

```
git checkout dev && git pull
git merge origin/main --no-ff -m "chore: sync main into dev after release"
git push origin dev
```

For feature → `dev` PRs, squash merge is fine (those branches are deleted after merge).

## CI Requirements

All PRs must pass these checks before merge:
- **Lint** — ESLint + Prettier (`pnpm lint` + `pnpm format:check`)
- **Type-check** — TypeScript strict mode (`pnpm type-check`)
- **Tests** — Node test runner (`pnpm test`)
- **Build** — Next.js production build (`pnpm build`)
- **Security** — Semgrep SAST + Trivy vulnerability scan + Lizard complexity
