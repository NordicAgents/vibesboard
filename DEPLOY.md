# Deployment Guide

VibeAgent runs on **Google Cloud Run** with secrets in **Secret Manager**, cron jobs via **Cloud Scheduler**, and payments via **Stripe**.

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) (for local webhook testing)
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
           │                   │                   │
     Secret Manager      Cloud Scheduler       Stripe
     (16 secrets)        (2 cron jobs)       (webhooks)
```

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

### 2. Set up Stripe products and prices

Run the setup script with your **live** Stripe secret key:

```bash
STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/stripe-setup.ts
```

This creates Products, Billing Meters, and Prices in Stripe. Copy the printed Price IDs into your `.env` file.

### 3. Configure Stripe webhook

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://www.vibesboard.com/api/stripe/webhook`
3. Select events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.created`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in your `.env`

### 4. Push secrets to Google Secret Manager

```bash
./scripts/setup-secrets.sh
```

Verify:

```bash
gcloud secrets list --project=vibesboard
```

### 5. Deploy

```bash
./deploy-cloud-run.sh
```

## Environment Variables

### Build-time (embedded in client JS bundle)

These are passed as Docker `--build-arg` and baked into the Next.js client bundle. Changing them requires a rebuild.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase client API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |
| `NEXT_PUBLIC_AUTH_GOOGLE` | Enable Google OAuth (`true`/`false`) |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL (`https://www.vibesboard.com`) |
| `NEXT_PUBLIC_META_APP_ID` | Meta/Facebook app ID |
| `NEXT_PUBLIC_FB_LOGIN_CONFIG_ID` | Facebook Login config ID |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (`pk_live_...`) |

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
| `firebase-service-account-key` | `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase Console > Service Accounts |
| `encryption-key` | `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `cron-secret` | `CRON_SECRET` | `openssl rand -hex 32` |
| `whatsapp-access-token` | `WHATSAPP_ACCESS_TOKEN` | Meta Business Dashboard |
| `whatsapp-verify-token` | `VERIFY_TOKEN` | `openssl rand -hex 32` |
| `whatsapp-inbox-verify-token` | `WHATSAPP_INBOX_VERIFY_TOKEN` | `openssl rand -hex 32` |
| `instagram-inbox-verify-token` | `INSTAGRAM_INBOX_VERIFY_TOKEN` | `openssl rand -hex 32` |
| `meta-app-secret` | `META_APP_SECRET` | Meta App Dashboard > Settings |
| `resend-api-key` | `RESEND_API_KEY` | [Resend](https://resend.com/api-keys) |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | [Stripe](https://dashboard.stripe.com/apikeys) |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard > Webhooks |
| `stripe-price-pro-base` | `STRIPE_PRICE_PRO_BASE` | `scripts/stripe-setup.ts` output |
| `stripe-price-pro-overage` | `STRIPE_PRICE_PRO_OVERAGE` | `scripts/stripe-setup.ts` output |
| `stripe-price-team-base` | `STRIPE_PRICE_TEAM_BASE` | `scripts/stripe-setup.ts` output |
| `stripe-price-team-overage` | `STRIPE_PRICE_TEAM_OVERAGE` | `scripts/stripe-setup.ts` output |

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
| `scripts/stripe-setup.ts` | Create Stripe Products, Meters, and Prices |
| `scripts/migrate-free-plan.ts` | Migrate existing tenants to Free plan defaults |
| `scripts/smoke-test.sh` | Verify deployed endpoints return expected status codes |
| `scripts/deploy-all.sh` | Deploy Cloud Functions + Firestore rules + Cloud Run |

## Local Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Start Stripe webhook listener (separate terminal)
stripe listen --forward-to localhost:3001/api/stripe/webhook
```

The Stripe CLI prints a webhook signing secret (`whsec_...`) — set it as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

### Test card numbers

| Card | Scenario |
|------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 3220` | 3D Secure authentication required |
| `4000 0000 0000 0341` | Payment fails (card declined) |

Use any future expiry date and any 3-digit CVC.

## Billing Architecture

```
Free Plan (100 msgs/mo)
  │
  ├── Upgrade to Pro ──→ Stripe Checkout ──→ $19/mo immediate billing
  │                                          5,000 msgs/mo
  │
  └── Upgrade to Team ──→ Stripe Checkout ──→ $10/seat/mo immediate billing
                                              10,000 msgs/seat/mo
                                              Min 3 seats

Subscription lifecycle:
  Checkout ──→ webhook: subscription.created ──→ Firestore updated
  Monthly   ──→ webhook: invoice.created     ──→ overage calculated
            ──→ webhook: payment_succeeded   ──→ counters reset
  Cancel    ──→ webhook: subscription.deleted ──→ downgrade to Free
  Failed    ──→ webhook: payment_failed      ──→ suspend after 3 attempts
```

No trial periods. The Free plan serves as the trial.

## Troubleshooting

**Build fails with "Neither apiKey nor config.authenticator"**
The Stripe SDK initializes lazily via Proxy. If this error appears, ensure `lib/stripe.ts` uses the lazy pattern, not `new Stripe()` at module scope.

**Webhook returns 400 "Invalid signature"**
The `STRIPE_WEBHOOK_SECRET` doesn't match. For local dev, use the secret from `stripe listen` output. For production, use the secret from Stripe Dashboard > Webhooks > your endpoint.

**Pricing page redirects to sign-in**
Ensure `'pricing'` is in `RESERVED_SLUGS` in `middleware.ts` AND `!pathname.includes('/pricing')` is in the `isProtectedRoute` check.

**Cloud Scheduler returns 401/403**
The cron secret in Secret Manager doesn't match what the app expects. Re-run `./scripts/setup-secrets.sh` and redeploy.
