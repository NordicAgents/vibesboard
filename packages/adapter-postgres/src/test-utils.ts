import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import * as schema from './schema/index.ts'
import { withTenant, type TenantContext } from './tenant-context.ts'

type Db = PostgresJsDatabase<typeof schema>

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, '..', 'drizzle')

function readMigrationFiles(): { name: string; sql: string }[] {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(drizzleDir, name), 'utf8') }))
}

function migrateUrl(): string {
  return (
    process.env.DATABASE_MIGRATE_URL ??
    'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'
  )
}

/**
 * Create an isolated test schema, apply all migrations into it, hand the
 * caller two Drizzle clients (one BYPASSRLS for setup, one app-role for the
 * code under test), and drop the schema when done.
 *
 * Per-schema isolation (not per-database) keeps startup at ~50ms.
 */
export async function withTestDb<T>(
  fn: (opts: {
    adminDb: Db
    appDb: Db
    schemaName: string
    seed: (ctx: TenantContext, work: () => Promise<void>) => Promise<void>
  }) => Promise<T>,
): Promise<T> {
  const schemaName = `test_${randomUUID().replace(/-/g, '_')}`
  const adminClient = postgres(migrateUrl(), { max: 2, prepare: false })
  const appUrl = (process.env.DATABASE_URL ??
    'postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev')
  const appClient = postgres(appUrl, { max: 2, prepare: false })

  try {
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await adminClient.unsafe(`SET search_path TO "${schemaName}"`)
    await appClient.unsafe(`SET search_path TO "${schemaName}", public`)

    for (const m of readMigrationFiles()) {
      // Run each migration file inside the new schema. The SQL was generated
      // assuming `public`; we route it via search_path. Skip the
      // CREATE EXTENSION lines — extensions are database-wide and were
      // already created by docker/init.sql when Postgres started.
      await adminClient.unsafe(`SET search_path TO "${schemaName}", public`)
      const filtered = m.sql
        .split(/\r?\n/)
        .filter((line) => !/^\s*CREATE EXTENSION/i.test(line))
        .join('\n')
      await adminClient.unsafe(filtered)
    }

    const adminDb = drizzle(adminClient, { schema }) as Db
    const appDb = drizzle(appClient, { schema }) as Db

    // Helper: run `work` with RLS context applied via a transaction.
    const seed = async (ctx: TenantContext, work: () => Promise<void>) => {
      await withTenant(ctx, async () => {
        await appDb.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`)
          await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId ?? ''}, true)`)
          await tx.execute(sql`SELECT set_config('app.is_super_admin', ${ctx.isSuperAdmin ? 'true' : 'false'}, true)`)
          await work()
        })
      })
    }

    return await fn({ adminDb, appDb, schemaName, seed })
  } finally {
    try {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
    } finally {
      await Promise.all([adminClient.end({ timeout: 1 }), appClient.end({ timeout: 1 })])
    }
  }
}
