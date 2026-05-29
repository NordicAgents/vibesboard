<h1 align="center">Vibesboard</h1>

<p align="center">
  A multi-tenant AI agent platform. Lets businesses create, configure, and deploy AI agents with multi-tenant workspace isolation, RAG, calendar availability/scheduling, WhatsApp/Instagram integration, MCP server support, agent hooks, and usage metering.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#architecture-overview"><strong>Architecture</strong></a> ·
  <a href="#setup"><strong>Setup</strong></a> ·
  <a href="#development"><strong>Development</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a> ·
  <a href="#environment-variables"><strong>Env vars</strong></a> ·
  <a href="#troubleshooting"><strong>Troubleshooting</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) 16 App Router (`@vibesboard/web`, React 19)
- [Vercel AI SDK](https://sdk.vercel.ai/docs) (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`) for streaming chat
- AI provider: **OpenAI** (`createOpenAI` + `OPENAI_API_KEY`), wired in `packages/ai/src/runtime.ts`
- shadcn/ui-style components built on [Radix UI](https://radix-ui.com) primitives + [Tailwind CSS](https://tailwindcss.com)
- Icons from [lucide-react](https://lucide.dev)
- Database: [PostgreSQL](https://postgresql.org) (with pgvector) and [Drizzle ORM](https://orm.drizzle.team)
- S3-compatible object storage via MinIO/R2/AWS S3 (`@vibesboard/adapter-s3`)
- Authentication via [Better-Auth](https://better-auth.com): Google OAuth, email + password, magic link

> Note: the AI integration is OpenAI-only — `packages/ai/src/runtime.ts` wires `createOpenAI` with `OPENAI_API_KEY`. There is no Anthropic SDK in the codebase (the only "Anthropic" reference is a comment in `packages/contracts`). Earlier docs described the stack as "Anthropic Claude API"; this has been corrected to OpenAI to match the code.
> **Needs confirmation:** whether the project intends to add Anthropic or "custom" model support in future.

## Architecture overview

Vibesboard is a pnpm monorepo (`vibeagent-monorepo`, private) pinned to `pnpm@10.18.1`.

```
apps/
  web/        Next.js 16 App Router app (@vibesboard/web) — UI, route handlers, middleware, auth
packages/     20 @vibesboard/* workspace packages (no build step; run via node --experimental-strip-types)
```

Key packages:

| Package | Purpose |
| --- | --- |
| `adapter-postgres` | Postgres data plane: Drizzle schema, connection client, tenant-context/RLS, migrations, seed, test utils |
| `adapter-s3` | S3-compatible binary storage (MinIO/R2/B2/AWS S3) |
| `adapter-better-auth` | Better-Auth identity layer wired to Postgres (Google OAuth, email+password, magic link) |
| `adapter-google` | Google API touchpoints (RISC / Cross-Account Protection) |
| `adapter-openai` | OpenAI Responses API + chat-completions shim (direct fetch, no SDK) |
| `ai`, `agents`, `retrieval` | Agent runtime, completion loop, tool execution, RAG, agent CRUD/hooks |
| `channel-whatsapp`, `channel-instagram`, `channel-chatwoot`, `inbox` | Messaging channels + unified inbox |
| `scheduling`, `booking-enquiries`, `data` | Calendar/OAuth, ICS bookings, agent data actions |
| `tenants`, `policy` | Workspaces/memberships, access control, plan/usage metering |
| `contracts`, `utils`, `integrations` | Domain types/port interfaces, pure helpers, integration registry |

**Data plane:** the Next.js app and workers connect through `DATABASE_URL` (the `vibesboard_app` role, subject to row-level security). Migrations and admin scripts use `DATABASE_MIGRATE_URL` (the `vibesboard_migrate` role, `BYPASSRLS`) only. `withDb`/`withTenant` from `@vibesboard/adapter-postgres` apply `SET LOCAL` GUCs so RLS enforces tenant isolation — queries outside a `withTenant` wrapper fail closed (return zero rows). Object storage goes through the S3 adapter (MinIO locally), and identity through Better-Auth backed by Postgres.

> Note: `apps/functions/` is a leftover, inactive Firebase Cloud Functions stub (no `package.json`, no exported functions). It is not part of the active Postgres/Cloud Run stack.

## Setup

Requirements: [Docker](https://www.docker.com), [pnpm](https://pnpm.io), Node 22 (CI uses Node 22 for PR checks).

Copy the example env file and populate the required vars (see [Environment variables](#environment-variables)):

```bash
cp .env.example .env
```

> Do not commit your `.env` — it would expose secrets that grant access to your provider accounts.

Install dependencies:

```bash
pnpm install
```

Bring up local infra (Postgres + MinIO) and apply schema + seed data:

```bash
pnpm db:setup    # docker compose up Postgres + Adminer + MinIO, then migrate + seed
```

`db:setup` runs `db:up` (starts `postgres`, `adminer`, `minio`, `minio-init` from `docker-compose.dev.yml`), waits, then `db:migrate` and `db:seed`.

## Development

```bash
pnpm dev         # next dev (apps/web)
```

The dev server runs on Next.js's default port; `cors.json` whitelists `http://localhost:3000` as a local origin.
**Needs confirmation:** the dev port is not set explicitly in any config file read; 3000 is the Next.js default.

Useful local infra commands (all defined in the root `package.json`):

```bash
pnpm db:up        # start Postgres + Adminer + MinIO
pnpm db:down      # stop containers
pnpm db:reset     # down -v, then db:up + migrate + seed (fresh DB)
pnpm db:migrate   # drizzle-kit migrate (adapter-postgres)
pnpm db:generate  # drizzle-kit generate (new migration from schema)
pnpm db:seed      # run adapter-postgres seed
pnpm db:studio    # open Drizzle Studio (drizzle-kit studio)
pnpm minio:console # open http://localhost:9001 (MinIO console)
```

Adminer is available at <http://localhost:8888> and the MinIO API at <http://localhost:9000> (console at <http://localhost:9001>).

> `pnpm db:studio` launches `drizzle-kit studio`. Drizzle Studio's hosted UI defaults to <https://local.drizzle.studio>, but that URL is a drizzle-kit default — it is not configured anywhere in this repo.

### Lint and type-check

```bash
pnpm lint          # pnpm -r lint (only apps/web has a lint script)
pnpm format:check  # prettier --check (apps/web)
pnpm format:write  # prettier --write (apps/web)
pnpm type-check    # pnpm -r type-check (tsc --noEmit per package)
```

> Only `apps/web` defines `lint`/`format:check`, so `pnpm lint` and `pnpm format:check` effectively cover the web app only. In CI the type-check job runs with `continue-on-error: true`, so a type-check failure does not currently block a merge.

## Testing

```bash
pnpm test    # pnpm -r --if-present test (Node built-in test runner)
```

Tests use the Node test runner (`node --experimental-strip-types --test`). The root `test` script runs recursively with `--if-present`, so packages without a `test` script (e.g. `adapter-openai`, `contracts`, `integrations`, `retrieval`, `utils`) are skipped.

Database-backed tests need Postgres + MinIO running (`pnpm db:up`) and migrations applied (`pnpm db:migrate`) — this is what CI does before `pnpm test`.

Run a single package's tests:

```bash
pnpm --filter @vibesboard/adapter-postgres test
```

## Build

```bash
pnpm build    # pnpm --filter @vibesboard/web build (next build)
```

`NEXT_PUBLIC_*` values are baked in at build time. The production container build uses the multi-stage `Dockerfile` (node:20-alpine, Next.js standalone output) and serves on port 8080:

```bash
docker build -t vibeagent .
```

The Dockerfile accepts build args `NEXT_PUBLIC_AUTH_GOOGLE`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_META_APP_ID`, and `NEXT_PUBLIC_FB_LOGIN_CONFIG_ID`, runs as non-root user `nextjs`, and starts with `node apps/web/server.js`.

## Deployment

Deployment targets Google Cloud Run (project `vibesboard`, service `vibeagent`, region `europe-north1`).

CI/CD: pushing to `dev` or `main` triggers `.github/workflows/deploy-cloudrun.yml`, which runs Drizzle migrations over an IAP tunnel and then builds/pushes the image and deploys to Cloud Run via Workload Identity Federation.

Manual deploy from a workstation uses `deploy-cloud-run.sh` (prefers podman, falls back to docker):

```bash
./deploy-cloud-run.sh
```

The script:

- requires `gcloud` installed + authenticated, and sets project `vibesboard`;
- builds a `--platform linux/amd64` image with the `NEXT_PUBLIC_*` build args and pushes to `gcr.io/vibesboard/vibeagent`;
- deploys Cloud Run with `--allow-unauthenticated --port=8080 --memory=1Gi --cpu=1 --min-instances=1 --max-instances=3 --timeout=600s`;
- injects runtime config via `--set-env-vars` (`OPENAI_MODEL`, `GCS_BUCKET_NAME`, `NEXT_PUBLIC_APP_URL`, `NOTIFICATION_EMAIL_FROM`, optional `WHATSAPP_PHONE_NUMBER_ID`) and `--set-secrets` from Google Secret Manager (OpenAI/WhatsApp/Meta/encryption/cron/Resend/Stripe/Google secrets, all `:latest`);
- creates two Cloud Scheduler jobs (region `europe-west1`): `vibeagent-process-whatsapp-queue` (every 30 min → `GET /api/cron/process-whatsapp-queue`) and `vibeagent-billing-reset` (daily 02:00 UTC → `POST /api/cron/billing-reset`).

> **⚠️ `deploy-cloud-run.sh` is stale for the current Postgres/S3/Better Auth stack — prefer the CI workflow.** It still sets the legacy `GCS_BUCKET_NAME` (unused in code) and does **not** set the runtime configuration the app now requires:
>
> - `DATABASE_URL` and `DATABASE_MIGRATE_URL` — `packages/adapter-postgres/src/client.ts` throws if either is unset when a query (or Better Auth's identity layer) runs;
> - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — `packages/adapter-s3/src/client.ts` throws if any is unset on first storage use;
> - `BETTER_AUTH_SECRET` — `packages/adapter-better-auth/src/config.ts` throws under `NODE_ENV=production` (the Cloud Run runtime) when unset.
>
> A service deployed from this script starts but fails as soon as it touches the database, auth, or storage. The GitHub Actions workflow `deploy-cloudrun.yml` is the source of truth — it sets all of the above from per-environment secrets. Use it for real deploys, and update `deploy-cloud-run.sh` to match (add the DB/S3/Better Auth env + secrets, drop `GCS_BUCKET_NAME`) before relying on the manual path.

Populate Secret Manager from a `.env` file with `scripts/setup-secrets.sh` (idempotent upsert; `PROJECT_ID=vibesboard`; `NEXT_PUBLIC_*` are treated as build-time args, not secrets):

```bash
./scripts/setup-secrets.sh [path/to/.env]
```

Google RISC (Cross-Account Protection) stream registration:

```bash
GOOGLE_SERVICE_ACCOUNT_KEY=... NEXT_PUBLIC_APP_URL=... \
  node --experimental-strip-types scripts/register-risc.ts
```

## Environment variables

Defined in [`.env.example`](.env.example). Generate secrets with `openssl rand -hex 32`.

### AI (OpenAI)

| Variable | Notes |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API key (platform.openai.com) |
| `OPENAI_MODEL` | Chat model (example value `gpt-5.4-nano`) |
| `OPENAI_VISION_MODEL` | Optional vision model override (commented out) |
| `OPENAI_EMBEDDINGS_MODEL` | Optional embeddings model override (commented out) |

### App / auth

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical site URL for production (fallback for building absolute URLs) |
| `NEXT_PUBLIC_AUTH_GOOGLE` | Build-time arg only — **not read anywhere in app code**, so it does not enable or disable Google OAuth. The "Continue with Google" button renders unconditionally on `/sign-in` and `/sign-up`; setting this to `false` has no effect. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth client credentials. These are the *actual* OAuth switch: the Better Auth `google` provider is registered only when both are present (`packages/adapter-better-auth/src/config.ts`). Leave them unset to disable Google sign-in. |
| `BETTER_AUTH_SECRET` | Server-side session signing (`openssl rand -hex 32`) |
| `ACCESS_GATE_SECRET` | Hashes access passwords + signs cookies for access-gated public agents |

### Webhooks / channels (WhatsApp, Instagram, Meta)

| Variable | Notes |
| --- | --- |
| `VERIFY_TOKEN` | Webhook verification token (GET + POST) |
| `WHATSAPP_PHONE_NUMBER_ID` | From Facebook App Dashboard → WhatsApp Business |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business access token |
| `WHATSAPP_INBOX_VERIFY_TOKEN` | WhatsApp inbox webhook verify token |
| `INSTAGRAM_INBOX_VERIFY_TOKEN` | Instagram inbox webhook verify token |
| `META_APP_SECRET` | Webhook signature verification |
| `ENCRYPTION_KEY` | Encrypts WhatsApp token storage (`openssl rand -hex 32`) |

### Cron / RISC

| Variable | Notes |
| --- | --- |
| `CRON_SECRET` | Authenticates scheduled queue processing (`openssl rand -hex 32`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON; used by `scripts/register-risc.ts` to register the RISC stream |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 Web client ID; verifies RISC Security Event Token audience |

### Email (Resend)

| Variable | Notes |
| --- | --- |
| `RESEND_API_KEY` | Resend API key (commented out; without it, emails log to console) |
| `NOTIFICATION_EMAIL_FROM` | From address for notifications (commented out) |

### Database (Postgres)

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | App role (`vibesboard_app`) — subject to RLS; used by app + workers |
| `DATABASE_MIGRATE_URL` | Migrate role (`vibesboard_migrate`) — BYPASSRLS; drizzle-kit + admin scripts only |

### Storage (S3 / MinIO)

| Variable | Notes |
| --- | --- |
| `S3_ENDPOINT` | e.g. `http://localhost:9000` for MinIO |
| `S3_REGION` | Default `us-east-1` |
| `S3_BUCKET` | e.g. `vibesboard-files` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credentials (MinIO dev defaults: `vibesboard`) |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO; `false` for AWS S3/R2 virtual-hosted style |

## Sign-in methods

By default the self-host stack supports three sign-in flows:

- **Google OAuth** — set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Without these, the Google button on the sign-in page does nothing.
- **Email + password** — works without extra config; email verification is required. Resend delivers verification mail (`RESEND_API_KEY`); without a key, verification URLs log to the server console (fine for dev).
- **Magic link** — same Resend wiring and console fallback.

## Troubleshooting

- **`DATABASE_URL`/`DATABASE_MIGRATE_URL` errors on startup** — both are required by `adapter-postgres`; copy `.env.example` to `.env` and ensure `pnpm db:up` is running.
- **Tenant-scoped queries return zero rows** — RLS fails closed outside a `withTenant` wrapper. Ensure data access goes through `withTenant`/`withDb`.
- **MinIO bucket missing / upload errors** — `db:up` runs a one-shot `minio-init` job that creates the `vibesboard-files` bucket; if it didn't run, re-run `pnpm db:up`. Check the console at <http://localhost:9001>.
- **Stale DB after schema changes** — run `pnpm db:reset` for a clean DB (`down -v` + migrate + seed).
- **Containers won't start / port conflicts** — Postgres (5432), Adminer (8888), MinIO (9000/9001) must be free; stop conflicting services or run `pnpm db:down`.
- **Build fails on missing `NEXT_PUBLIC_*`** — these are baked at build time; pass them as Docker build args or set them before `pnpm build`.
- **Emails not sending in dev** — without `RESEND_API_KEY`, verification/magic-link URLs are logged to the server console instead of emailed.

## Project docs and links

- [`CLAUDE.md`](CLAUDE.md) — AI agent guidelines, branching/release strategy, CI requirements.
- [`AGENTS.md`](AGENTS.md) — agent guidelines (mirrors `CLAUDE.md`).
- [`packages/adapter-postgres/README.md`](packages/adapter-postgres/README.md) — Postgres data plane, RLS, migrations.
- [`packages/adapter-s3/README.md`](packages/adapter-s3/README.md) — S3-compatible storage adapter.
- [`packages/adapter-better-auth/README.md`](packages/adapter-better-auth/README.md) — Better-Auth identity layer.
