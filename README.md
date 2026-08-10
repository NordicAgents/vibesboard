<h1 align="center">Vibesboard</h1>

<p align="center">
  An open-source, multi-tenant platform for building and operating AI agents across web chat, messaging channels, business data, and scheduling workflows.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a> ·
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#testing"><strong>Testing</strong></a> ·
  <a href="#configuration"><strong>Configuration</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a>
</p>

## Features

- **Agent builder and runtime** — create versioned agents with streaming chat, tools, hooks, public sharing, access gates, and per-agent settings.
- **Tenant isolation** — workspace-scoped data backed by PostgreSQL row-level security (RLS), with separate application and migration roles.
- **Bring your own LLM** — connect OpenAI, Anthropic, Google Gemini, NVIDIA, or an OpenAI-compatible endpoint such as Groq, Mistral, Together AI, or Ollama.
- **Flexible model routing** — select models per agent or task (`chat`, `embed`, and `agent_creator`), with workspace defaults and a platform OpenAI fallback.
- **Knowledge and memory** — RAG over uploaded files with pgvector, S3-compatible storage, re-embedding workflows, and an optional hybrid long-term memory engine.
- **Messaging channels** — WhatsApp and Instagram inboxes plus Chatwoot synchronization.
- **Actions and integrations** — Google Calendar availability and booking, Google Sheets, custom webhooks, MCP servers, and agent hooks.
- **Authentication and operations** — Better Auth with Google OAuth, email/password, and magic links; usage metering, feature flags, admin controls, and health checks.

## Tech stack

- [Next.js](https://nextjs.org) 16.2 and React 19
- TypeScript 5.9, Tailwind CSS, Radix UI, and Lucide icons
- [Vercel AI SDK](https://ai-sdk.dev) 7 with OpenAI, Anthropic, and Google provider adapters
- PostgreSQL, pgvector, and [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://better-auth.com)
- S3-compatible object storage (MinIO locally; AWS S3, R2, GCS, or compatible services in production)
- Bun 1.2.18 workspaces, Vitest 4, and Playwright

## Architecture

Vibesboard is a Bun monorepo with one Next.js application and 22 workspace packages:

```text
apps/
  web/                  Next.js UI, server components, and API routes
packages/
  adapter-*/            PostgreSQL, S3, Better Auth, Google, and OpenAI adapters
  agents/               Agent persistence, hooks, notifications, and versioning
  ai/                   Runtime, provider routing, tools, RAG, and memory integration
  channel-*/            WhatsApp, Instagram, and Chatwoot channels
  contracts/            Shared domain types and ports
  data/                  Google Sheets, webhook connections, and data actions
  hybrid-memory/         Long-term agent memory engine
  inbox/                 Unified inbox services
  policy/                Plans, feature flags, permissions, and usage metering
  retrieval/             Retrieval strategies
  scheduling/            Calendar OAuth, availability, and booking
  tenants/               Workspace and membership services
  test-helpers/          Shared integration-test infrastructure
  utils/                 Shared utilities
```

The Next.js app uses two database connections:

- `DATABASE_URL` connects as `vibesboard_app`. RLS applies, and tenant-scoped work must run through `withTenant`/`withDb` so the correct PostgreSQL session context is set.
- `DATABASE_MIGRATE_URL` connects as `vibesboard_migrate` with `BYPASSRLS`. It is reserved for migrations, identity operations, and trusted background/admin work.

Tenant LLM credentials are encrypted at rest. Runtime resolution checks an agent override, a task assignment, the wildcard task assignment, and the workspace default before falling back to the platform OpenAI configuration. Custom provider URLs pass SSRF validation at save time and again before runtime use.

## Quick start

### Requirements

- [Bun](https://bun.sh) 1.2.18
- Node.js 22
- Docker with Compose
- An OpenAI API key for the platform fallback model

### Install and run

```bash
git clone https://github.com/NordicAgents/vibeagent.git
cd vibeagent

cp .env.example .env
# Edit .env and replace placeholder credentials/secrets.

bun install
bun run db:setup
bun run dev
```

Open <http://localhost:3000>. `db:setup` starts PostgreSQL, Adminer, MinIO, and the MinIO bucket initializer, then applies migrations and seed data.

Do not commit `.env`; it contains credentials that grant access to your database and external providers.

## Development

### Common commands

```bash
bun run dev             # Start the Next.js development server
bun run build           # Create a production build
bun run start           # Start the production build
bun run lint            # Lint the web application
bun run lint:fix        # Apply supported ESLint fixes
bun run format:check    # Check web-app formatting
bun run format:write    # Format web-app source
bun run type-check      # Type-check every workspace package
```

### Local infrastructure

```bash
bun run db:up           # Start PostgreSQL, Adminer, and MinIO
bun run db:down         # Stop local infrastructure
bun run db:reset        # Recreate volumes, migrate, and seed
bun run db:migrate      # Apply Drizzle migrations
bun run db:generate     # Generate a migration from schema changes
bun run db:seed         # Seed development data
bun run db:studio       # Open Drizzle Studio
bun run minio:console   # Open the MinIO console on macOS
```

Local service ports:

| Service | URL or port |
| --- | --- |
| Web app | <http://localhost:3000> |
| PostgreSQL | `localhost:5432` |
| Adminer | <http://localhost:8888> |
| MinIO API | <http://localhost:9000> |
| MinIO console | <http://localhost:9001> |

## Testing

The root Vitest configuration discovers the package and application test projects. Database- and storage-backed tests require the local services and migrations.

```bash
bun run db:up
bun run db:migrate

bun run test            # Full Vitest suite
bun run test:coverage   # Vitest with V8 coverage
bun run test:e2e        # Primary Playwright suite
```

The deeper local Playwright suite covers agent creation and chat, BYO-LLM, settings, public agents, conversations, knowledge files, administration, API contracts, and cross-tenant isolation:

```bash
bun run --filter @vibesboard/web test:e2e:local
```

It uses a deterministic mock OpenAI server, requires five local secrets, and can run against Docker or native PostgreSQL/MinIO. See [`docs/local-e2e.md`](docs/local-e2e.md) for setup details.

Pull requests to `dev` or `main` run lint/format, type-checking, Vitest coverage, both Playwright suites, the production build, Semgrep, Trivy, and complexity analysis. Type-checking is a blocking CI gate.

## Configuration

Start with [`.env.example`](.env.example). The most important groups are:

### Platform AI

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Platform fallback key used when a workspace has no applicable provider configuration |
| `OPENAI_MODEL` | Default chat model |
| `OPENAI_VISION_MODEL` | Optional model override for vision tasks |
| `OPENAI_AGENT_CREATOR_MODEL` | Optional model override for the agent-creation assistant |
| `OPENAI_EMBEDDINGS_MODEL` | Optional OpenAI embedding-model override |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible gateway, proxy, or test endpoint |
| `GOOGLE_EMBEDDING_MODEL` | Optional Google embedding-model override for tenant Google providers |

Workspace administrators can configure provider keys and task routing in **Settings → LLM Providers**. Supported provider kinds are `openai`, `anthropic`, `google`, `nvidia`, and `openai_compatible`; no provider-specific tenant keys belong in the process environment.

### Application and auth

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL and auth callback base |
| `BETTER_AUTH_SECRET` | Server-side session signing secret; required in production |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Enable Google sign-in when both are set |
| `RESEND_API_KEY` | Email delivery for verification, password reset, magic links, and notifications |
| `NOTIFICATION_EMAIL_FROM` | Sender identity for application email |
| `ACCESS_GATE_SECRET` | Hashes public-agent access passwords and signs access cookies |

`NEXT_PUBLIC_AUTH_GOOGLE` is retained as a build argument but is not read by application code. Google OAuth is enabled only by `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### Data and storage

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | RLS-enforced application connection |
| `DATABASE_MIGRATE_URL` | Privileged migration/admin connection |
| `DATABASE_POOL_MAX` | Optional application pool size; defaults to `10` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | S3-compatible storage location |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Storage credentials |
| `S3_FORCE_PATH_STYLE` | Use `true` for local MinIO and `false` for virtual-hosted production services |
| `ENCRYPTION_KEY` | Encrypts tenant provider, OAuth, and channel credentials at rest |

### Integrations

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar OAuth and the default credentials for Google Sheets OAuth |
| `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET` | Optional dedicated Google Sheets OAuth credentials |
| `VERIFY_TOKEN`, `META_APP_SECRET` | Meta webhook verification and signature validation |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Platform WhatsApp credentials |
| `WHATSAPP_INBOX_VERIFY_TOKEN`, `INSTAGRAM_INBOX_VERIFY_TOKEN` | Inbox webhook verification |
| `CRON_SECRET` | Authenticates scheduled and background endpoints |
| `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_OAUTH_CLIENT_ID` | Google Cross-Account Protection (RISC) registration and token verification |

Generate local secrets with `openssl rand -hex 32`.

## Authentication

The self-hosted stack supports:

- **Google OAuth** when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.
- **Email and password** with mandatory email verification.
- **Magic links** through the same Resend integration.

Without `RESEND_API_KEY`, development email URLs are written to the server console. Production deployments should always configure a real mail provider and a strong `BETTER_AUTH_SECRET`.

## Deployment

The maintained deployment path is [`.github/workflows/deploy-cloudrun.yml`](.github/workflows/deploy-cloudrun.yml). A push to `dev` deploys staging and a push to `main` deploys production. The workflow:

1. opens an IAP tunnel and applies database migrations;
2. builds and pushes the standalone Next.js image to Artifact Registry;
3. deploys it to Cloud Run with VPC access, environment-specific secrets, PostgreSQL, and S3 configuration.

The container listens on port `8080` and runs as the non-root `nextjs` user.

> `deploy-cloud-run.sh` is a legacy manual path and is not aligned with the current PostgreSQL/S3/Better Auth deployment. It omits required runtime secrets and still carries legacy GCS/Stripe configuration. Use the GitHub Actions workflow until that script is brought back in sync.

`scripts/setup-secrets.sh` can seed the older shared Secret Manager names from a local env file, but the CI workflow also expects environment-specific database, auth, and storage secrets.

## Security notes

- Tenant-owned tables use PostgreSQL RLS and fail closed without tenant context.
- Provider and integration credentials are encrypted before storage and never returned by read APIs.
- Tenant-supplied provider and webhook URLs are validated to reduce SSRF exposure; private hosts require an explicit tenant opt-in or host allowlist.
- CI runs Semgrep and Trivy on changes to protected branches.
- Keep `DATABASE_MIGRATE_URL` out of normal request code; it bypasses tenant RLS by design.

## Troubleshooting

- **Database configuration error** — copy `.env.example` to `.env`, start the compose services, and verify both database URLs.
- **Tenant query returns no rows** — ensure the operation is inside `withTenant`/`withDb`; RLS intentionally fails closed otherwise.
- **Upload or bucket error** — rerun `bun run db:up` so `minio-init` can create `vibesboard-files`, then inspect <http://localhost:9001>.
- **Stale schema or seed data** — run `bun run db:reset` for a clean local environment.
- **Port conflict** — free ports 3000, 5432, 8888, 9000, and 9001, or override the applicable service configuration.
- **Missing nested dependency after install** — run `bun install --force`; see the E2E guide for known Bun 1.2.18 dependency-materialization issues.
- **Emails not arriving locally** — inspect the server console when `RESEND_API_KEY` is unset.

## Project documentation

- [`docs/byo-llm.md`](docs/byo-llm.md) — tenant provider configuration and routing
- [`docs/local-e2e.md`](docs/local-e2e.md) — complete local Playwright setup
- [`packages/adapter-postgres/README.md`](packages/adapter-postgres/README.md) — PostgreSQL, migrations, and RLS
- [`packages/adapter-s3/README.md`](packages/adapter-s3/README.md) — S3-compatible storage
- [`packages/adapter-better-auth/README.md`](packages/adapter-better-auth/README.md) — authentication adapter
- [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) — contributor and release workflow

## License

Licensed under the [Apache License 2.0](LICENSE).
