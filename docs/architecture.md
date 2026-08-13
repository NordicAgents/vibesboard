# Architecture

Vibesboard is a Bun monorepo containing one Next.js application and 22 workspace
packages. The workspace globs are `apps/web` and `packages/*`.

## Repository layout

```text
apps/
  web/                   Next.js UI, server components, and API routes
packages/
  adapter-better-auth/   Better Auth wiring, sessions, and password tooling
  adapter-google/        Google OAuth and API clients
  adapter-openai/        OpenAI and OpenAI-compatible client adapter
  adapter-postgres/      Drizzle schema, migrations, seeds, and RLS roles
  adapter-s3/            S3-compatible object storage
  agents/                Agent persistence, hooks, notifications, and versioning
  ai/                    Runtime, provider routing, tools, RAG, and memory integration
  booking-enquiries/     Booking enquiry capture, ICS generation, and notifications
  channel-chatwoot/      Chatwoot synchronisation
  channel-instagram/     Instagram inbox channel
  channel-whatsapp/      WhatsApp inbox channel
  contracts/             Shared domain types and ports
  data/                  Google Sheets, webhook connections, and data actions
  hybrid-memory/         Long-term agent memory engine
  inbox/                 Unified inbox services
  integrations/          Integration registry and helpers
  policy/                Plans, feature flags, permissions, and usage metering
  retrieval/             Retrieval strategies
  scheduling/            Calendar OAuth, availability, and booking
  tenants/               Workspace and membership services
  test-helpers/          Shared integration-test infrastructure
  utils/                 Shared utilities
```

## Database connections and tenant isolation

The Next.js app uses two separate PostgreSQL connections, and the distinction is
load-bearing for multi-tenant safety:

| Connection | Role | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `vibesboard_app` | Normal request path. Row-level security applies. |
| `DATABASE_MIGRATE_URL` | `vibesboard_migrate` (`BYPASSRLS`) | Migrations, identity operations, and trusted background/admin work. |

Tenant-scoped work must run through `withTenant`/`withDb` so the correct
PostgreSQL session context is set. Tenant-owned tables fail closed without that
context — a query outside `withTenant` returns no rows rather than leaking across
workspaces.

Keep `DATABASE_MIGRATE_URL` out of normal request code. It bypasses tenant RLS by
design.

See [`packages/adapter-postgres/README.md`](../packages/adapter-postgres/README.md)
for the schema, migration workflow, and role setup.

## Model provider routing

Workspaces bring their own LLM credentials, encrypted at rest. At runtime the
resolver checks, in order:

1. an agent-level provider override;
2. a task assignment (`chat`, `embed`, `agent_creator`);
3. the wildcard task assignment;
4. the workspace default;
5. the platform OpenAI configuration (`OPENAI_API_KEY` / `OPENAI_MODEL`).

Supported provider kinds are `openai`, `anthropic`, `google`, `nvidia`, and
`openai_compatible`. Custom provider URLs pass SSRF validation at save time and
again before runtime use.

Full detail and the routing diagram live in [`byo-llm.md`](byo-llm.md) and
[`byo-llm-architecture.svg`](byo-llm-architecture.svg).

## Storage

Uploads and knowledge-base files go to S3-compatible object storage — MinIO
locally, and AWS S3, Cloudflare R2, GCS, or a compatible service in production.
See [`packages/adapter-s3/README.md`](../packages/adapter-s3/README.md).
