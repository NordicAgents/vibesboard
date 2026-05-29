# @vibesboard/adapter-postgres

Postgres data plane for Vibesboard. Drizzle schema, migrations, connection
client, tenant-context helper, RLS plumbing, a seed script, and an
ephemeral-DB testing utility.

This package is now
depended on across the monorepo (agents, ai, policy, scheduling, data,
tenants, channel-\*, booking-enquiries, inbox, adapter-better-auth).

## Exports

The package barrel (`.`) is intentionally empty — import from subpaths:

| Subpath | Path | Provides |
| --- | --- | --- |
| `./client` | `src/client.ts` | `withDb`, `getDb`, `getMigrateDb` (transaction + RLS wrappers) |
| `./schema` | `src/schema/index.ts` | Drizzle table definitions (users, tenants, agents, conversations, files, vectors, scheduling, channels, policy, data, branding, …) |
| `./tenant-context` | `src/tenant-context.ts` | `withTenant`, `TenantContext` type |
| `./test-utils` | `src/test-utils.ts` | `withTestDb` ephemeral-DB helper |
| `./types` | `src/types.ts` | Shared TypeScript types |

```ts
import { withDb }     from '@vibesboard/adapter-postgres/client'
import * as schema    from '@vibesboard/adapter-postgres/schema'
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
```

## Environment variables

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | App role (RLS-enforced) connection used by `getDb`/`withDb` |
| `DATABASE_MIGRATE_URL` | Yes | — | Migrate role (BYPASSRLS) used by drizzle-kit, seed, and admin scripts |
| `DATABASE_POOL_MAX` | No | `10` | Max pool size for the app connection |
| `NEXT_PHASE` | No | — | Set by Next.js to skip real connections during build/export |

See `.env.example` at the repo root for sample values.

## Scripts

This package defines two `db:*` scripts (both run via `drizzle-kit`):

```bash
bun run --filter @vibesboard/adapter-postgres db:generate  # drizzle-kit generate (emit a new migration)
bun run --filter @vibesboard/adapter-postgres db:migrate   # drizzle-kit migrate (apply pending migrations)
```

The higher-level convenience scripts (`db:up`, `db:down`, `db:reset`,
`db:setup`, `db:seed`, `db:studio`, `minio:console`) live in the **root**
`package.json`, not here.

## Local dev

From the repo root:

```bash
bun run db:setup   # docker compose up postgres + adminer + minio, then migrate + seed
bun run db:studio  # launch drizzle-kit studio
```

`db:setup` runs `db:up && sleep 3 && db:migrate && db:seed`; `db:up` brings
up Postgres, Adminer, and MinIO via `docker-compose.dev.yml`.

**Needs confirmation:** the exact URL Drizzle Studio serves (commonly
`https://local.drizzle.studio`) is a drizzle-kit default, not configured in
this repo.

## Usage

```ts
import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
import { withDb }     from '@vibesboard/adapter-postgres/client'
import { messages }   from '@vibesboard/adapter-postgres/schema'

await withTenant({ tenantId, userId, isSuperAdmin: false }, async () => {
  const rows = await withDb((tx) =>
    tx.select().from(messages).where(eq(messages.conversationId, convId))
  )
})
```

`withDb` opens a transaction, applies the tenant context's `SET LOCAL`
GUCs so RLS enforces isolation, then runs your function and commits.
Without an active `withTenant` wrapper, tenant-scoped queries return
zero rows (fail closed).
