# GitHub CD Pipeline Design

## Overview

Continuous deployment for Vibesboard using GitHub Actions with Workload Identity Federation to GCP. Deploys the Next.js frontend to Cloud Run, Firebase Functions, Firestore rules/indexes, and Storage rules.

## Environment Strategy

- **Single GCP project:** `vibesboard`
- **Two Firebase projects:** `vibesboard` (production), `vibesboard-staging` (staging)
- **Two Cloud Run services:** `vibesboard-prod`, `vibesboard-staging`
- **Cloud Run region:** Same region as existing production service (to be confirmed during setup)
- **Branch mapping:** `dev` branch deploys to staging, `main` branch deploys to production

## Authentication: Workload Identity Federation

Keyless authentication from GitHub Actions to GCP via OIDC token exchange.

### GCP Setup (one-time manual)

1. Create Workload Identity Pool: `github-actions-pool`
2. Create OIDC Provider linked to `https://token.actions.githubusercontent.com`
3. Attribute condition: `assertion.repository == 'NordicAgents/vibeagent'`
4. Service account: `github-actions-deployer@vibesboard.iam.gserviceaccount.com`
5. Roles granted to the service account:
   - `roles/run.admin` — deploy Cloud Run services
   - `roles/iam.serviceAccountUser` — act as Cloud Run runtime service account
   - `roles/artifactregistry.writer` — push Docker images
   - `roles/firebase.admin` — deploy Functions, rules, indexes
   - `roles/storage.admin` — deploy storage rules
6. Bind service account to the Workload Identity Pool for the repo

### Reusable Composite Action

Shared auth logic extracted to `.github/actions/gcp-auth/action.yml`:

**Inputs:** `workload_identity_provider`, `service_account`

**Steps:**
1. `google-github-actions/auth@v2` with WIF inputs
2. `google-github-actions/setup-gcloud@v2`

All workflows reference this action to avoid duplicating auth config.

## Workflow 1: Cloud Run Deployment

**File:** `.github/workflows/deploy-cloudrun.yml`

**Triggers:**
```
push to dev or main
paths: src/**, package.json, pnpm-lock.yaml, Dockerfile, next.config.js, tailwind.config.*, app/**, components/**, lib/**
```

**Steps:**
1. Checkout code
2. Determine environment — `dev` branch uses staging vars, `main` branch uses prod vars
3. Authenticate to GCP via composite action
4. Configure Docker for Artifact Registry
5. Build & push Docker image to `us-docker.pkg.dev/vibesboard/vibeagent/app:$SHA`
   - Pass environment-specific `NEXT_PUBLIC_*` vars as build args (baked into Next.js build)
6. Deploy to Cloud Run via `google-github-actions/deploy-cloudrun@v2`
   - Service: `vibesboard-staging` or `vibesboard-prod`
   - Server-side secrets referenced from GCP Secret Manager at runtime

## Workflow 2: Firebase Functions Deployment

**File:** `.github/workflows/deploy-functions.yml`

**Triggers:**
```
push to dev or main
paths: functions/**
```

**Steps:**
1. Checkout code
2. Determine environment — `dev` deploys to `vibesboard-staging`, `main` deploys to `vibesboard`
3. Authenticate to GCP via composite action
4. Set up Node 20
5. Install dependencies — `npm ci` in `functions/`
6. Build — `npm run build` in `functions/`
7. Deploy — `firebase deploy --only functions --project <firebase-project>`

Server-side env vars for functions managed via Firebase environment config per project, not baked into the build.

## Workflow 3: Firebase Rules & Indexes Deployment

**File:** `.github/workflows/deploy-firebase-rules.yml`

**Triggers:**
```
push to dev or main
paths: firestore.rules, storage.rules, firestore.indexes.json
```

**Steps:**
1. Checkout code
2. Determine environment — `dev` deploys to `vibesboard-staging`, `main` deploys to `vibesboard`
3. Authenticate to GCP via composite action
4. Deploy — `firebase deploy --only firestore:rules,firestore:indexes,storage --project <firebase-project>`

## GitHub Secrets Inventory

### Shared
| Secret | Purpose |
|--------|---------|
| `GCP_PROJECT_ID` | `vibesboard` |
| `WIF_PROVIDER` | Workload Identity Provider resource name |
| `WIF_SERVICE_ACCOUNT` | Deployer service account email |

### Staging-prefixed (dev branch)
| Secret | Purpose |
|--------|---------|
| `STAGING_FIREBASE_PROJECT` | `vibesboard-staging` |
| `STAGING_NEXT_PUBLIC_FIREBASE_API_KEY` | Staging Firebase API key |
| `STAGING_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Staging auth domain |
| `STAGING_NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `vibesboard-staging` |
| `STAGING_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Staging storage bucket |
| `STAGING_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Staging sender ID |
| `STAGING_NEXT_PUBLIC_FIREBASE_APP_ID` | Staging app ID |
| `STAGING_NEXT_PUBLIC_APP_URL` | Staging Cloud Run URL |
| `STAGING_CLOUD_RUN_SERVICE` | `vibesboard-staging` |

### Prod-prefixed (main branch)
Same pattern with `PROD_` prefix, pointing to existing production values.

### Server-side secrets
Stripe, OpenAI, WhatsApp, Resend, and other server-side secrets are stored in **GCP Secret Manager** and referenced by Cloud Run and Firebase Functions at runtime. They are not stored as GitHub secrets.

## Security Considerations

### Branch Protection
- `main` and `dev` require PR reviews and passing status checks before merge
- Direct pushes to `main` blocked; only merges from `dev` or hotfix branches

### Secrets Access
- GitHub secrets not exposed to PR workflows from forks (GitHub default)
- WIF scoped to `NordicAgents/vibeagent` repo only
- Server-side secrets in GCP Secret Manager, never in GitHub or build logs

### Artifact Registry
- Images tagged by commit SHA for traceability
- Old images cleaned up via lifecycle policy

### Workflow Permissions
```yaml
permissions:
  contents: read
  id-token: write  # Required for WIF OIDC token
```

Minimal permissions — no write access to repo contents.

## Files to Create

| File | Purpose |
|------|---------|
| `.github/actions/gcp-auth/action.yml` | Reusable WIF auth composite action |
| `.github/workflows/deploy-cloudrun.yml` | Cloud Run CD workflow |
| `.github/workflows/deploy-functions.yml` | Firebase Functions CD workflow |
| `.github/workflows/deploy-firebase-rules.yml` | Firebase rules/indexes CD workflow |

## Pre-requisites (Manual GCP Setup)

Before the workflows can run, these must be set up manually in GCP:

1. Create Firebase project `vibesboard-staging`
2. Create Workload Identity Pool and Provider
3. Create and configure deployer service account with required roles
4. Create Artifact Registry repository `vibeagent`
5. Create Cloud Run services `vibesboard-staging` and `vibesboard-prod` (or let first deploy create them)
6. Store server-side secrets in GCP Secret Manager
7. Configure GitHub repo secrets (shared + staging + prod)
