# Development

## Requirements

- [Bun](https://bun.sh) 1.2.18
- Node.js 22
- Docker with Compose
- An OpenAI API key for the platform fallback model

## Install and run

```bash
git clone https://github.com/NordicAgents/vibesboard.git
cd vibeagent

cp .env.example .env
# Edit .env and replace placeholder credentials/secrets.

bun install
bun run db:setup
bun run dev
```

Open <http://localhost:3000>. `db:setup` starts PostgreSQL, Adminer, MinIO, and
the MinIO bucket initializer, then applies migrations and seed data.

Do not commit `.env`; it contains credentials that grant access to your database
and external providers. See [`configuration.md`](configuration.md) for what each
variable does.

## Common commands

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

## Local infrastructure

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

The root Vitest configuration discovers the package and application test
projects. Database- and storage-backed tests require the local services and
migrations.

```bash
bun run db:up
bun run db:migrate

bun run test            # Full Vitest suite
bun run test:coverage   # Vitest with V8 coverage
bun run test:e2e        # Primary Playwright suite
```

The deeper local Playwright suite covers agent creation and chat, BYO-LLM,
settings, public agents, conversations, knowledge files, administration, API
contracts, and cross-tenant isolation:

```bash
bun run --filter @vibesboard/web test:e2e:local
```

It uses a deterministic mock OpenAI server, requires five local secrets, and can
run against Docker or native PostgreSQL/MinIO. See [`local-e2e.md`](local-e2e.md)
for setup details, including the no-Docker path.

## Continuous integration

Pull requests to `dev` or `main` run lint/format, type-checking, Vitest coverage,
both Playwright suites, the production build, Semgrep, Trivy, and complexity
analysis. Type-checking is a blocking gate.

## Branching and releases

- `dev` — staging environment
- `main` — production environment
- Feature branches merge into `dev` via PR (squash merge is fine).
- `dev` merges into `main` for production releases. **Always use a merge commit**
  — squash or rebase merges rewrite SHAs and cause phantom conflicts on the next
  release PR. Back-merge `main` into `dev` immediately afterwards.
- Releases are automated on push to `main` by release-please, which reads
  conventional commits (`feat(scope):`, `fix(scope):`, `chore(scope):`).

[`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md) carry the full
contributor and release workflow.

## Troubleshooting

- **Database configuration error** — copy `.env.example` to `.env`, start the
  compose services, and verify both database URLs.
- **Tenant query returns no rows** — ensure the operation is inside
  `withTenant`/`withDb`; RLS intentionally fails closed otherwise.
- **Upload or bucket error** — rerun `bun run db:up` so `minio-init` can create
  `vibesboard-files`, then inspect <http://localhost:9001>.
- **Stale schema or seed data** — run `bun run db:reset` for a clean local
  environment.
- **Port conflict** — free ports 3000, 5432, 8888, 9000, and 9001, or override
  the applicable service configuration.
- **Missing nested dependency after install** — run `bun install --force`; see
  [`local-e2e.md`](local-e2e.md) for known Bun 1.2.18 dependency-materialization
  issues.
- **Emails not arriving locally** — inspect the server console when
  `RESEND_API_KEY` is unset.
