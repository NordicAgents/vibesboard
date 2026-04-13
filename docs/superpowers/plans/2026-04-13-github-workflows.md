# GitHub Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive CI quality gates and operational workflows to the Vibesboard GitHub repository.

**Architecture:** Split CI (lint, typecheck, test, build as separate workflows) + independent operational workflows (dependabot, stale cleanup, release, Lighthouse, image cleanup, health check). Each workflow is a standalone YAML file under `.github/workflows/`.

**Tech Stack:** GitHub Actions, pnpm, Node 20, GCP Workload Identity Federation, Google Lighthouse CI, `google-github-actions/*`

**Spec:** `docs/superpowers/specs/2026-04-13-github-workflows-design.md`

---

### Task 1: CI Lint & Format Workflow

**Files:**
- Create: `.github/workflows/ci-lint.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Lint & Format

on:
  pull_request:
    branches: [dev, main]

concurrency:
  group: ci-lint-${{ github.head_ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: pnpm format:check
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-lint.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci-lint.yml
git commit -m "ci: add lint and format check workflow for PRs"
```

---

### Task 2: CI TypeScript Type Check Workflow

**Files:**
- Create: `.github/workflows/ci-typecheck.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Type Check

on:
  pull_request:
    branches: [dev, main]

concurrency:
  group: ci-typecheck-${{ github.head_ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check (Next.js app)
        run: pnpm type-check

      - name: Type check (Cloud Functions)
        working-directory: functions
        run: npm ci && npm run build
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-typecheck.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci-typecheck.yml
git commit -m "ci: add TypeScript type check workflow for PRs"
```

---

### Task 3: CI Test Workflow

**Files:**
- Create: `.github/workflows/ci-test.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Tests

on:
  pull_request:
    branches: [dev, main]

concurrency:
  group: ci-test-${{ github.head_ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-test.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci-test.yml
git commit -m "ci: add test runner workflow for PRs"
```

---

### Task 4: CI Build Workflow

**Files:**
- Create: `.github/workflows/ci-build.yml`

The build needs `NEXT_PUBLIC_*` env vars. These are already stored as GitHub secrets (used by `deploy-cloudrun.yml`). We use the `STAGING_*` variants since this is a PR check — prod values aren't needed.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Build

on:
  pull_request:
    branches: [dev, main]

concurrency:
  group: ci-build-${{ github.head_ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_FIREBASE_API_KEY: ${{ secrets.STAGING_NEXT_PUBLIC_FIREBASE_API_KEY }}
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: ${{ secrets.STAGING_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN }}
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: ${{ secrets.STAGING_NEXT_PUBLIC_FIREBASE_PROJECT_ID }}
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: ${{ secrets.STAGING_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET }}
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.STAGING_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID }}
      NEXT_PUBLIC_FIREBASE_APP_ID: ${{ secrets.STAGING_NEXT_PUBLIC_FIREBASE_APP_ID }}
      NEXT_PUBLIC_APP_URL: ${{ secrets.STAGING_NEXT_PUBLIC_APP_URL }}
      NEXT_PUBLIC_AUTH_GOOGLE: ${{ secrets.STAGING_NEXT_PUBLIC_AUTH_GOOGLE }}
      NEXT_PUBLIC_META_APP_ID: ${{ secrets.STAGING_NEXT_PUBLIC_META_APP_ID }}
      NEXT_PUBLIC_FB_LOGIN_CONFIG_ID: ${{ secrets.STAGING_NEXT_PUBLIC_FB_LOGIN_CONFIG_ID }}
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ${{ secrets.STAGING_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-build.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci-build.yml
git commit -m "ci: add Next.js build verification workflow for PRs"
```

---

### Task 5: Dependabot Configuration

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create the Dependabot config**

```yaml
version: 2

updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    target-branch: dev
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types:
          - minor
          - patch

  - package-ecosystem: npm
    directory: /functions
    schedule:
      interval: weekly
      day: monday
    target-branch: dev
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types:
          - minor
          - patch
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: add Dependabot config for weekly dependency updates"
```

---

### Task 6: Stale Issue/PR Cleanup Workflow

**Files:**
- Create: `.github/workflows/stale.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Stale Issues & PRs

on:
  schedule:
    - cron: "0 9 * * 1"  # Every Monday at 09:00 UTC
  workflow_dispatch:

permissions:
  issues: write
  pull-requests: write

jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          stale-issue-message: "This issue has been automatically marked as stale due to 30 days of inactivity. It will be closed in 7 days if no further activity occurs."
          stale-pr-message: "This PR has been automatically marked as stale due to 14 days of inactivity. It will be closed in 7 days if no further activity occurs."
          close-issue-message: "Closed due to inactivity. Feel free to reopen if this is still relevant."
          close-pr-message: "Closed due to inactivity. Feel free to reopen if this is still relevant."
          days-before-issue-stale: 30
          days-before-pr-stale: 14
          days-before-issue-close: 7
          days-before-pr-close: 7
          stale-issue-label: stale
          stale-pr-label: stale
          exempt-issue-labels: "pinned,security,bug"
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/stale.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/stale.yml
git commit -m "ci: add stale issue and PR cleanup workflow"
```

---

### Task 7: Auto Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

Uses `googleapis/release-please-action` which is the standard for conventional-commit-based releases. It creates a "release PR" that accumulates changes, and when merged to `main`, creates the tag + GitHub Release.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
          target-branch: main
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add auto-release workflow with conventional commits"
```

---

### Task 8: Lighthouse Performance Audit Workflow

**Files:**
- Create: `.github/workflows/lighthouse.yml`

Triggers after the Cloud Run deploy workflow succeeds on `dev`. Uses `treosh/lighthouse-ci-action` to run audits and post results.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Lighthouse Audit

on:
  workflow_run:
    workflows: ["Deploy to Cloud Run"]
    types: [completed]
    branches: [dev]

permissions:
  contents: read
  actions: read

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - uses: actions/checkout@v4

      - name: Run Lighthouse
        uses: treosh/lighthouse-ci-action@v12
        with:
          urls: ${{ secrets.STAGING_NEXT_PUBLIC_APP_URL }}
          runs: 3
          configPath: .github/lighthouse/lighthouserc.json

      - name: Format results
        if: always()
        id: results
        run: |
          if [ -f ".lighthouseci/lhr-0.json" ]; then
            PERF=$(jq '.categories.performance.score * 100' .lighthouseci/lhr-0.json | cut -d. -f1)
            A11Y=$(jq '.categories.accessibility.score * 100' .lighthouseci/lhr-0.json | cut -d. -f1)
            BP=$(jq '.categories["best-practices"].score * 100' .lighthouseci/lhr-0.json | cut -d. -f1)
            SEO=$(jq '.categories.seo.score * 100' .lighthouseci/lhr-0.json | cut -d. -f1)
            echo "PERF=$PERF" >> $GITHUB_OUTPUT
            echo "A11Y=$A11Y" >> $GITHUB_OUTPUT
            echo "BP=$BP" >> $GITHUB_OUTPUT
            echo "SEO=$SEO" >> $GITHUB_OUTPUT
            echo "summary=Performance: $PERF | Accessibility: $A11Y | Best Practices: $BP | SEO: $SEO" >> $GITHUB_OUTPUT
            if [ "$PERF" -lt 50 ]; then
              echo "::error::Performance score $PERF is below threshold of 50"
              exit 1
            fi
          fi
```

- [ ] **Step 2: Create the Lighthouse CI config**

Create `.github/lighthouse/lighthouserc.json`:

```json
{
  "ci": {
    "collect": {
      "numberOfRuns": 3,
      "settings": {
        "preset": "desktop"
      }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["warn", { "minScore": 0.5 }],
        "categories:accessibility": ["warn", { "minScore": 0.7 }],
        "categories:best-practices": ["warn", { "minScore": 0.7 }],
        "categories:seo": ["warn", { "minScore": 0.7 }]
      }
    }
  }
}
```

- [ ] **Step 3: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/lighthouse.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/lighthouse.yml .github/lighthouse/lighthouserc.json
git commit -m "ci: add Lighthouse performance audit after staging deploy"
```

---

### Task 9: Artifact Registry Image Cleanup Workflow

**Files:**
- Create: `.github/workflows/image-cleanup.yml`

Uses `gcloud artifacts docker images` to list and delete old images. Relies on the existing GCP WIF composite action at `.github/actions/gcp-auth/action.yml`.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Artifact Registry Cleanup

on:
  schedule:
    - cron: "0 3 * * 0"  # Every Sunday at 03:00 UTC
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to GCP
        uses: ./.github/actions/gcp-auth
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Delete old images
        run: |
          REPO="us-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/vibeagent/app"
          KEEP_RECENT=10
          CUTOFF_DATE=$(date -d "30 days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v-30d +%Y-%m-%dT%H:%M:%S)

          echo "Fetching image digests from $REPO..."
          ALL_DIGESTS=$(gcloud artifacts docker images list "$REPO" \
            --format="csv[no-heading](DIGEST,CREATE_TIME)" \
            --sort-by="~CREATE_TIME")

          TOTAL=$(echo "$ALL_DIGESTS" | wc -l | tr -d ' ')
          echo "Found $TOTAL total images"

          if [ "$TOTAL" -le "$KEEP_RECENT" ]; then
            echo "Only $TOTAL images exist, keeping all (minimum $KEEP_RECENT)"
            exit 0
          fi

          # Skip the most recent N images, delete the rest if older than cutoff
          CANDIDATES=$(echo "$ALL_DIGESTS" | tail -n +$((KEEP_RECENT + 1)))
          DELETED=0

          while IFS=, read -r DIGEST CREATE_TIME; do
            if [ -z "$DIGEST" ]; then continue; fi
            if [[ "$CREATE_TIME" < "$CUTOFF_DATE" ]]; then
              echo "Deleting $DIGEST (created $CREATE_TIME)..."
              gcloud artifacts docker images delete "$REPO@$DIGEST" --quiet --delete-tags
              DELETED=$((DELETED + 1))
            fi
          done <<< "$CANDIDATES"

          echo "Deleted $DELETED images"
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/image-cleanup.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/image-cleanup.yml
git commit -m "ci: add weekly Artifact Registry image cleanup"
```

---

### Task 10: Health Check Workflow

**Files:**
- Create: `.github/workflows/health-check.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Health Check

on:
  schedule:
    - cron: "0 */6 * * *"  # Every 6 hours
  workflow_dispatch:

permissions:
  issues: write

jobs:
  staging:
    runs-on: ubuntu-latest
    steps:
      - name: Health check (staging)
        id: check
        run: |
          URL="${{ secrets.STAGING_NEXT_PUBLIC_APP_URL }}"
          if [ -z "$URL" ]; then
            echo "::warning::No URL configured for staging"
            exit 0
          fi
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$URL")
          echo "status=$HTTP_CODE" >> $GITHUB_OUTPUT
          if [ "$HTTP_CODE" -ne 200 ]; then
            echo "::error::staging returned HTTP $HTTP_CODE"
            exit 1
          fi
          echo "staging is healthy (HTTP $HTTP_CODE)"

      - name: Create incident issue
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const env = 'staging';
            const status = '${{ steps.check.outputs.status }}';
            const title = `[incident] ${env} health check failed (HTTP ${status})`;

            const existing = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              labels: 'incident',
              state: 'open',
            });
            const duplicate = existing.data.find(i => i.title.includes(env));
            if (duplicate) {
              console.log(`Open incident already exists: #${duplicate.number}`);
              return;
            }

            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title,
              body: `## Health Check Failure\n\n- **Environment:** ${env}\n- **HTTP Status:** ${status}\n- **Time:** ${new Date().toISOString()}\n- **Workflow Run:** ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}\n\nPlease investigate immediately.`,
              labels: ['incident'],
            });

  production:
    runs-on: ubuntu-latest
    steps:
      - name: Health check (production)
        id: check
        run: |
          URL="${{ secrets.PROD_NEXT_PUBLIC_APP_URL }}"
          if [ -z "$URL" ]; then
            echo "::warning::No URL configured for production"
            exit 0
          fi
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$URL")
          echo "status=$HTTP_CODE" >> $GITHUB_OUTPUT
          if [ "$HTTP_CODE" -ne 200 ]; then
            echo "::error::production returned HTTP $HTTP_CODE"
            exit 1
          fi
          echo "production is healthy (HTTP $HTTP_CODE)"

      - name: Create incident issue
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const env = 'production';
            const status = '${{ steps.check.outputs.status }}';
            const title = `[incident] ${env} health check failed (HTTP ${status})`;

            const existing = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              labels: 'incident',
              state: 'open',
            });
            const duplicate = existing.data.find(i => i.title.includes(env));
            if (duplicate) {
              console.log(`Open incident already exists: #${duplicate.number}`);
              return;
            }

            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title,
              body: `## Health Check Failure\n\n- **Environment:** ${env}\n- **HTTP Status:** ${status}\n- **Time:** ${new Date().toISOString()}\n- **Workflow Run:** ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}\n\nPlease investigate immediately.`,
              labels: ['incident'],
            });
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/health-check.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/health-check.yml
git commit -m "ci: add scheduled health check with incident auto-creation"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add branching strategy and CI requirements sections**

Append the following after the existing "Development Guidelines" section (after line 50) in `CLAUDE.md`:

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

- [ ] **Step 2: Verify the file reads correctly**

Run: `tail -20 CLAUDE.md`
Expected: The new sections appear at the bottom.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add branching strategy and CI requirements to CLAUDE.md"
```
