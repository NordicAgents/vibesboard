# @vibesboard/adapter-postgres

Postgres data plane for Vibesboard self-host. Schema, migrations,
connection client, tenant-context helper, RLS plumbing, and an
ephemeral-DB testing utility.

## Status

Sub-project #1 of the Firebase → Postgres/S3/Auth migration. Foundation
only — no existing callsite imports this package yet. See the
[design spec](../../docs/superpowers/specs/2026-05-17-adapter-postgres-foundation-design.md).

## Local dev

From the repo root:

```bash
pnpm db:setup   # docker compose up postgres + migrate + seed
pnpm db:studio  # open Drizzle Studio at https://local.drizzle.studio
```

## Imports

```ts
import { withDb }       from '@vibesboard/adapter-postgres/client'
import * as schema      from '@vibesboard/adapter-postgres/schema'
import { withTenant }   from '@vibesboard/adapter-postgres/tenant-context'
```

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
