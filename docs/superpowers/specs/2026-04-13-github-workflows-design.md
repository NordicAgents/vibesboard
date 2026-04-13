# GitHub Workflows — Comprehensive CI/CD & Operations Suite

**Date:** 2026-04-13
**Status:** Approved
**Approach:** Split CI jobs + individual operational workflows (Approach 2)

## Context

Vibesboard has 4 existing GitHub workflows:
- `deploy-cloudrun.yml` — Docker build + Cloud Run deploy (staging on `dev`, prod on `main`)
- `deploy-firebase-rules.yml` — Firestore/Storage rules & indexes
- `deploy-functions.yml` — Firebase Cloud Functions
- `security.yml` — Semgrep SAST, Trivy vulnerability scan, Lizard complexity

**Gap:** No CI checks run on PRs before merge — no lint, type-check, test, or build verification. No operational workflows for dependency management, cleanup, releases, or monitoring.

## Design Decisions

- **Split CI:** Each check (lint, typecheck, test, build) is a separate workflow for fastest feedback and fine-grained branch protection.
- **Strict gates:** All 4 CI checks + security must pass to merge. No exceptions.
- **Release strategy:** Auto-tag + changelog on merge to `main` using conventional commits. Tags only — no `package.json` version bumps.
- **Lighthouse:** Runs against staging URL after deploy to `dev` (no preview environments).
- **Health checks:** Create GitHub Issues on failure rather than external alerting.

## New Workflows

### 1. `ci-lint.yml` — Lint & Format Check

- **Trigger:** `pull_request` to `dev`, `main`
- **Steps:** checkout → setup pnpm + Node 20 → `pnpm install` → `pnpm lint` → `pnpm format:check`
- **Required status check:** Yes
- **Expected duration:** ~30s

### 2. `ci-typecheck.yml` — TypeScript Type Check

- **Trigger:** `pull_request` to `dev`, `main`
- **Steps:** checkout → setup pnpm + Node 20 → `pnpm install` → `pnpm type-check` → `cd functions && npm ci && npm run build`
- **Required status check:** Yes
- **Expected duration:** ~45s

### 3. `ci-test.yml` — Unit & Integration Tests

- **Trigger:** `pull_request` to `dev`, `main`
- **Steps:** checkout → setup pnpm + Node 20 → `pnpm install` → `pnpm test`
- **Required status check:** Yes
- **Expected duration:** ~30s

### 4. `ci-build.yml` — Next.js Production Build

- **Trigger:** `pull_request` to `dev`, `main`
- **Steps:** checkout → setup pnpm + Node 20 → `pnpm install` → `pnpm build`
- **Environment:** Needs `NEXT_PUBLIC_*` Firebase/Stripe/Meta env vars as GitHub secrets (same set as `deploy-cloudrun.yml`)
- **Required status check:** Yes
- **Expected duration:** ~2-3 min

### 5. `.github/dependabot.yml` — Dependency Updates

- **Type:** Dependabot config (not a workflow)
- **Schedule:** Weekly
- **Target branch:** `dev`
- **Ecosystems:** npm for `/` (root) and `/functions`
- **Grouping:** Minor + patch updates grouped together
- **Limit:** 5 open PRs max

### 6. `stale.yml` — Stale Issue/PR Cleanup

- **Trigger:** Cron, weekly on Mondays
- **Issues:** Label `stale` after 30 days inactive, close after 7 more days
- **PRs:** Label `stale` after 14 days inactive, close after 7 more days
- **Exempt labels:** `pinned`, `security`, `bug`

### 7. `release.yml` — Auto Release

- **Trigger:** Push to `main`
- **Behavior:** Parse conventional commits since last tag, determine version bump (feat → minor, fix → patch, breaking → major), create git tag + GitHub Release with changelog
- **Does NOT** bump `package.json` version (avoids commit loops)

### 8. `lighthouse.yml` — Performance Audit

- **Trigger:** `workflow_run` after `deploy-cloudrun.yml` succeeds on `dev`
- **Behavior:** Run Lighthouse CI against staging URL
- **Output:** Commit comment with Performance, Accessibility, Best Practices, SEO scores
- **Threshold:** Fail if Performance < 50 (configurable, start low and tighten)

### 9. `image-cleanup.yml` — Artifact Registry Cleanup

- **Trigger:** Cron, weekly on Sundays
- **Auth:** GCP WIF via existing composite action
- **Behavior:** Delete Docker images older than 30 days from `us-docker.pkg.dev/<project>/vibeagent/app`
- **Safety:** Always keep the 10 most recent images regardless of age

### 10. `health-check.yml` — Scheduled Health Checks

- **Trigger:** Cron, every 6 hours
- **Behavior:** HTTP GET to staging and production Cloud Run URLs (from `STAGING_NEXT_PUBLIC_APP_URL` and `PROD_NEXT_PUBLIC_APP_URL` secrets), check for 200 response
- **On failure:** Create a GitHub Issue labeled `incident` with the failing environment

## File Inventory

| File | Action | Trigger |
|---|---|---|
| `.github/workflows/ci-lint.yml` | Create | PR to dev/main |
| `.github/workflows/ci-typecheck.yml` | Create | PR to dev/main |
| `.github/workflows/ci-test.yml` | Create | PR to dev/main |
| `.github/workflows/ci-build.yml` | Create | PR to dev/main |
| `.github/dependabot.yml` | Create | Weekly schedule |
| `.github/workflows/stale.yml` | Create | Weekly cron (Mon) |
| `.github/workflows/release.yml` | Create | Push to main |
| `.github/workflows/lighthouse.yml` | Create | After staging deploy |
| `.github/workflows/image-cleanup.yml` | Create | Weekly cron (Sun) |
| `.github/workflows/health-check.yml` | Create | Every 6 hours |
| `CLAUDE.md` | Edit | N/A |

## CLAUDE.md Changes

Add under Development Guidelines:

```markdown
## Branching & Release Strategy

- `dev` — staging environment (Cloud Run + Firebase)
- `main` — production environment
- Feature branches merge to `dev` via PR
- `dev` merges to `main` for production releases
- Releases are auto-tagged on merge to `main` using conventional commits
- Commit format: `feat(scope): message`, `fix(scope): message`, `chore(scope): message`

## CI Requirements

All PRs must pass these checks before merge:
- **Lint** — ESLint + Prettier (`pnpm lint` + `pnpm format:check`)
- **Type-check** — TypeScript strict mode (`pnpm type-check`)
- **Tests** — Node test runner (`pnpm test`)
- **Build** — Next.js production build (`pnpm build`)
- **Security** — Semgrep SAST + Trivy vulnerability scan + Lizard complexity
```

## Out of Scope

- Preview/ephemeral environments per PR
- External alerting integrations (PagerDuty, Slack) for health checks
- E2E / browser testing (Playwright, Cypress)
- Functions-specific test runner (functions/ has no test script currently)
