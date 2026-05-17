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
import { db }           from '@vibesboard/adapter-postgres/client'
import * as schema      from '@vibesboard/adapter-postgres/schema'
import { withTenant }   from '@vibesboard/adapter-postgres/tenant-context'
```
