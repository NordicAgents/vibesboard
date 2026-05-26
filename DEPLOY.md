# Deployment Guide

VibeAgent runs on **Google Cloud Run** with secrets in **Secret Manager** and cron jobs via **Cloud Scheduler**.

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/)
- [pnpm](https://pnpm.io/) (package manager)
- GCP project: `vibesboard`
- Authenticated: `gcloud auth login && gcloud auth application-default login`

## Architecture

```
                        ┌──────────────────────┐
                        │   Cloud Run          │
                        │   vibeagent          │
                        │   europe-north1      │
                        │   Port 8080          │
                        └──────┬───────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │
     Secret Manager      Cloud Scheduler
     (Secrets)           (Cron jobs)

| Component | Details |
|-----------|---------|
| **Runtime** | Node 20 Alpine, Next.js standalone |
| **Region** | europe-north1 (Cloud Run), europe-west1 (Scheduler) |
| **Memory** | 1 GiB |
| **Instances** | 0–3 (scales to zero) |
| **Image** | gcr.io/vibesboard/vibeagent |

## Quick Deploy

```bash
# 1. Push secrets (first time or when values change)
./scripts/setup-secrets.sh

# 2. Deploy
./deploy-cloud-run.sh
```

That's it. The deploy script builds the Docker image, pushes to GCR, deploys to Cloud Run, and configures cron jobs.

## First-Time Setup

### 1. Create a `.env` file

Copy `.env.example` and fill in all values:

```bash
cp .env.example .env
```

### 2. Push secrets to Google Secret Manager

```bash
./scripts/setup-secrets.sh
```

Verify:

```bash
gcloud secrets list --project=vibesboard
```

### 3. Deploy

```bash
./deploy-cloud-run.sh
```

## Environment Variables

### Build-time (embedded in client JS bundle)

These are passed as Docker `--build-arg` and baked into the Next.js client bundle. Changing them requires a rebuild.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_AUTH_GOOGLE` | Enable Google OAuth (`true`/`false`) |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL (`https://www.vibesboard.com`) |
| `NEXT_PUBLIC_META_APP_ID` | Meta/Facebook app ID |
| `NEXT_PUBLIC_FB_LOGIN_CONFIG_ID` | Facebook Login config ID |

### Runtime (non-sensitive, set via `--set-env-vars`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_MODEL` | `gpt-4o-mini` | Default LLM model |
| `GCS_BUCKET_NAME` | `vibeagent-files` | GCS bucket for file uploads |
| `NEXT_PUBLIC_APP_URL` | `https://www.vibesboard.com` | App URL (also runtime) |
| `NOTIFICATION_EMAIL_FROM` | `VibeAgent <notifications@vibeagent.com>` | Email sender |
| `WHATSAPP_PHONE_NUMBER_ID` | — | WhatsApp Business phone number ID |

### Secrets (injected from Google Secret Manager)

| Secret Manager Name | Env Var | Source |
|---------------------|---------|--------|
| `openai-api-key` | `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) |
| `encryption-key` | `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `cron-secret` | `CRON_SECRET` | `openssl rand -hex 32` |
| `whatsapp-access-token` | `WHATSAPP_ACCESS_TOKEN` | Meta Business Dashboard |
| `whatsapp-verify-token` | `VERIFY_TOKEN` | `openssl rand -hex 32` |
| `whatsapp-inbox-verify-token` | `WHATSAPP_INBOX_VERIFY_TOKEN` | `openssl rand -hex 32` |
| `instagram-inbox-verify-token` | `INSTAGRAM_INBOX_VERIFY_TOKEN` | `openssl rand -hex 32` |
| `meta-app-secret` | `META_APP_SECRET` | Meta App Dashboard > Settings |
| `resend-api-key` | `RESEND_API_KEY` | [Resend](https://resend.com/api-keys) |

## Cron Jobs

Managed by Cloud Scheduler (europe-west1). Created/updated automatically by `deploy-cloud-run.sh`.

| Job | Schedule | Endpoint | Method | Auth |
|-----|----------|----------|--------|------|
| `vibeagent-process-whatsapp-queue` | Every 30 min | `/api/cron/process-whatsapp-queue` | GET | `Authorization: Bearer <CRON_SECRET>` |
| `vibeagent-billing-reset` | Daily 2:00 AM UTC | `/api/cron/billing-reset` | POST | `x-cron-secret: <CRON_SECRET>` |

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy-cloud-run.sh` | Build, push, deploy to Cloud Run + configure cron |
| `scripts/setup-secrets.sh` | Push `.env` values to Google Secret Manager |
| `scripts/smoke-test.sh` | Verify deployed endpoints return expected status codes |

## Local Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

## Troubleshooting

**Cloud Scheduler returns 401/403**
The cron secret in Secret Manager doesn't match what the app expects. Re-run `./scripts/setup-secrets.sh` and redeploy.
