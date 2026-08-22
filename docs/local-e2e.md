# Running the E2E suites locally

Two Playwright suites live in this repo:

| Suite      | Config                                | Specs                          | Runs in CI?                          |
| ---------- | ------------------------------------- | ------------------------------ | ------------------------------------ |
| CI suite   | `apps/web/playwright.config.ts`       | `apps/web/e2e/*.spec.ts`       | yes (`.github/workflows/ci-e2e.yml`) |
| Deep suite | `apps/web/playwright.local.config.ts` | `apps/web/e2e/local/*.spec.ts` | yes (`.github/workflows/ci-e2e.yml`) |

The second suite is the deep one, covering agents, chat, settings, BYO-LLM
providers, public widget, conversations, knowledge base, sharing, agent features,
admin panel, API contracts, and tenant isolation. It uses a separate global setup
because it needs an outsider account, a superadmin cookie jar, and additional state.

Both configs read `E2E_APP_PORT` (default **3100**) and `MOCK_OPENAI_PORT`
(default **4010**) from `apps/web/e2e/constants.ts`, so they use the same dedicated
ports when run sequentially. They refuse to reuse pre-existing processes on
those ports. The test server also enables a non-production-only routing guard,
so persisted tenant provider settings cannot bypass the mock and call a paid
model API.

## 1. Infrastructure

The suite needs two services: Postgres (with the `vector` and `pg_trgm`
extensions) and something S3-compatible. Either option below works — the config
reads `DATABASE_URL`, `DATABASE_MIGRATE_URL` and `S3_ENDPOINT` from the
environment and only falls back to the Docker defaults.

MinIO is addressed as `http://127.0.0.1:9000` rather than `localhost:9000` in
both setups — Node resolves `localhost` to IPv6 first and MinIO listens on IPv4.

### Option A — Docker

`playwright.local.config.ts` defaults to Postgres on **5434**, not the compose
default of 5432, because 5432 is commonly taken by a native Postgres.

```bash
POSTGRES_HOST_PORT=5434 docker compose -f docker-compose.dev.yml up -d postgres minio minio-init

export DATABASE_MIGRATE_URL='postgres://vibesboard_migrate:vibesboard_migrate@localhost:5434/vibesboard_dev'
export DATABASE_URL='postgres://vibesboard_app:vibesboard_app@localhost:5434/vibesboard_dev'
bun run db:migrate
```

### Option B — no Docker (native Homebrew)

Both Playwright suites and the full Vitest suite can run on this setup. It is
useful if Docker Desktop's disk footprint is a problem —
its images plus build cache can run to tens of GB.

```bash
brew install postgresql@18 pgvector minio
brew services start postgresql@18            # or however you already run it
```

`pgvector` builds against both `postgresql@17` and `@18`; its files land in
`$(pg_config --sharedir)/extension`, so the extension is available to the
running server without extra linking.

Create the database and apply the same bootstrap the Docker image runs from
`docker-entrypoint-initdb.d` (extensions, the two roles, grants):

```bash
createdb vibesboard_dev
psql -d vibesboard_dev -v ON_ERROR_STOP=1 -f packages/adapter-postgres/docker/init.sql
```

Start MinIO and create the bucket:

```bash
mkdir -p /opt/homebrew/var/minio
MINIO_ROOT_USER=vibesboard MINIO_ROOT_PASSWORD=vibesboard \
  minio server --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 \
  /opt/homebrew/var/minio &

# the bucket, via the SDK already in node_modules
node --input-type=module -e "
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
const s3 = new S3Client({ endpoint: 'http://127.0.0.1:9000', region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'vibesboard', secretAccessKey: 'vibesboard' } })
await s3.send(new CreateBucketCommand({ Bucket: 'vibesboard-files' }))
"
```

Then point the suite at the native cluster (default port) and migrate:

```bash
export DATABASE_MIGRATE_URL='postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'
export DATABASE_URL='postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev'
bun run db:migrate
```

> Homebrew's `minio` formula is deprecated (upstream archived; the formula is
> slated for removal in Feb 2027). It works today; if it goes away, the official
> `minio` binary or any S3-compatible server on `S3_ENDPOINT` will do.

## 2. Secrets

`playwright.local.config.ts` resolves four secrets from `process.env`, falling
back to the gitignored `apps/web/.env.local`, and **throws** if any is missing:

`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `ACCESS_GATE_SECRET`

`BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` must match whatever the local database
was seeded with — `ENCRYPTION_KEY` wraps tenant LLM API keys at rest, so changing
it makes existing provider rows undecryptable. `CRON_SECRET` is a plain
shared-secret comparison; any dev value works.

## 3. Dependencies

Install with a **complete** tree before running:

```bash
bun install
```

If the app boots but every route returns 500 with a Turbopack
`Module not found` / `Export … doesn't exist in target module` error, the
`node_modules` tree is partial — a plain `bun install` on a stale tree can install
top-level packages while failing to materialise the _nested_ copies the lockfile
requires. Two failures seen in practice:

- `Can't resolve '@ai-sdk/anthropic'` from `packages/ai/src/provider-registry.ts`
- `Export email doesn't exist in target module` from `better-auth` — it needs its
  own nested `zod@4`, but resolved to the hoisted `zod@3` the workspace pins

Both are fixed by forcing a full re-materialisation:

```bash
bun install --force
```

> Note: older Bun releases may rewrite `bun.lock` metadata written by the
> repository's pinned Bun version. That diff is a tool-version artifact, not a
> dependency change — revert it with `git checkout bun.lock` before committing.

A module error in one route can leave the dev server returning 500 for _every_
route, including `/` and `/api/health`. After fixing dependencies, restart the
dev server and delete `apps/web/.next` so nothing stale is served.

## 4. Run

```bash
cd apps/web

# deep suite
bun run test:e2e:local

# just the smoke specs
bun run test:e2e:local:smoke

# the CI suite, against the same servers
DATABASE_URL='postgres://vibesboard_app:vibesboard_app@localhost:5434/vibesboard_dev' \
DATABASE_MIGRATE_URL='postgres://vibesboard_migrate:vibesboard_migrate@localhost:5434/vibesboard_dev' \
bun run test:e2e
```

Playwright's `webServer` entries use `reuseExistingServer: false`, so if a dev
server is already listening on 3100 or the mock on 4010, the run fails outright
on a port conflict instead of reusing it — free those ports first.

## 5. Test state

`e2e/local/global-setup.ts` runs before every invocation and is responsible for
keeping runs idempotent. It signs up (or reuses) `e2e-tester@vibesboard.local`
and `superadmin@vibesboard.local`, saves both cookie jars, and deletes leftovers:

- team tenants matching `e2e-team-%`, `e2e-extra-team-%`, `e2e-collision-%`,
  `e2e-admin-tenant-%` — this keeps the account under `MAX_TEAM_WORKSPACES` (5)
- `tenant_llm_configs` rows labelled `E2E %` — these live on the _personal_
  tenant, which is never deleted, so without this they accumulate every run

There is no `globalTeardown`; cleanup happens at the start of the next run.

## 6. Disk

`next dev` under Turbopack grows `apps/web/.next` steadily (~2.3 GB after a few
full runs). If the volume fills, Turbopack panics with
`No space left on device (os error 28)` and requests hang forever. Check
`df -g /System/Volumes/Data` before a long session; `rm -rf apps/web/.next`
reclaims it instantly.
