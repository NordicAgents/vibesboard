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
  // Set search_path via the connection option so EVERY connection in the pool
  // uses the test schema from the moment it is created, even when the pool
  // creates a second connection mid-test (e.g. during concurrent Promise.all).
  // Previously, only the first connection had search_path set via unsafe(),
  // causing concurrent tests to hit the wrong (public) schema.
  const adminClient = postgres(migrateUrl(), {
    max: 2,
    prepare: false,
    connection: { search_path: `"${schemaName}", public` },
  })
  const appUrl = (process.env.DATABASE_URL ??
    'postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev')
  const appClient = postgres(appUrl, {
    max: 2,
    prepare: false,
    connection: { search_path: `"${schemaName}", public` },
  })

  // Extract the app role name from the app URL so we can grant privileges.
  const appRole = new URL(appUrl).username

  try {
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`)
    // Grant the app role access to the test schema so search_path resolution
    // works and RLS policies can be evaluated against the test-schema tables.
    await adminClient.unsafe(`GRANT USAGE ON SCHEMA "${schemaName}" TO ${appRole}`)
    await adminClient.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schemaName}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`)
    // search_path is now set via the `connection` option on both clients so all
    // pool connections (including lazily-created ones) use the test schema.
    // The explicit SET calls below are kept as a safety net for the first connection.

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
        // Rewrite "public"."tablename" → "schemaName"."tablename" so FK
        // constraints created in the test schema reference the schema-local
        // tables rather than public.  Migrations are generated with explicit
        // public-schema qualifiers; without this substitution every FK check
        // would look up the parent row in public instead of the test schema.
        .replace(/"public"\./g, `"${schemaName}".`)
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
