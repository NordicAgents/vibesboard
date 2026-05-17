import 'server-only'
import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase, type PostgresJsTransaction } from 'drizzle-orm/postgres-js'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import * as schema from './schema/index.ts'
import { getContext } from './tenant-context.ts'
import { rlsSetLocalSql } from './rls.ts'

export type Db = PostgresJsDatabase<typeof schema>
export type DbTx = PostgresJsTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>

function readUrl(name: 'DATABASE_URL' | 'DATABASE_MIGRATE_URL'): string {
  const url = process.env[name]
  if (!url) {
    throw new Error(
      `[adapter-postgres] ${name} is not set. See .env.example for the expected value.`,
    )
  }
  return url
}

let _appSql: postgres.Sql | undefined
let _appDb: Db | undefined

function appSql(): postgres.Sql {
  if (!_appSql) {
    _appSql = postgres(readUrl('DATABASE_URL'), {
      prepare: false, // play well with PgBouncer transaction-mode if it ever fronts us
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    })
  }
  return _appSql
}

/**
 * The lazily-initialized Drizzle client for the app role. NOT exported
 * directly — callers must go through `withDb` (or the raw `db.transaction`
 * via `getDb()`) so that RLS context is applied to every query.
 *
 * If you import this and just call `getDb().select()…`, the query will run
 * against an empty tenant context — RLS will return zero rows for every
 * tenant-scoped table. Fail closed.
 */
export function getDb(): Db {
  if (!_appDb) {
    _appDb = drizzle(appSql(), { schema })
  }
  return _appDb
}

/**
 * Run `fn` against a Drizzle transaction with the current tenant context
 * applied via `SET LOCAL` GUCs, so RLS policies enforce isolation. This is
 * the supported entrypoint for all app-code DB calls.
 *
 *   import { withTenant } from '@vibesboard/adapter-postgres/tenant-context'
 *   import { withDb }     from '@vibesboard/adapter-postgres/client'
 *
 *   await withTenant({ tenantId, userId, isSuperAdmin: false }, async () => {
 *     const rows = await withDb((tx) => tx.select().from(messages))
 *   })
 *
 * If there is no active `withTenant` context, the GUCs are set to empty
 * strings — RLS policies use NULLIF and evaluate false, so tenant-scoped
 * tables return zero rows. Fail closed.
 */
export function withDb<T>(fn: (tx: DbTx) => Promise<T> | T): Promise<T> {
  const ctx = getContext() ?? {
    tenantId: '',
    userId: null,
    isSuperAdmin: false,
  }
  return getDb().transaction(async (tx) => {
    for (const stmt of rlsSetLocalSql(ctx)) {
      await tx.execute(stmt)
    }
    return fn(tx)
  })
}

/**
 * Lower-level admin-style client that uses DATABASE_MIGRATE_URL. Used by
 * migrations and the ephemeral-DB test helper. NOT for app code — this role
 * bypasses RLS.
 */
export function createMigrateClient(): Db {
  const client = postgres(readUrl('DATABASE_MIGRATE_URL'), { prepare: false, max: 2 })
  return drizzle(client, { schema })
}

export { schema }
