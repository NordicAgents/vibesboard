import 'server-only'
import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema/index.ts'
import { getContext } from './tenant-context.ts'
import { rlsSetLocalSql } from './rls.ts'

export type Db = PostgresJsDatabase<typeof schema>

function readUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      '[adapter-postgres] DATABASE_URL is not set. See .env.example for the expected value.',
    )
  }
  return url
}

let _sql: postgres.Sql | undefined
let _db: Db | undefined

function rawSql(): postgres.Sql {
  if (!_sql) {
    _sql = postgres(readUrl(), {
      prepare: false, // play well with PgBouncer transaction-mode if it ever fronts us
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    })
  }
  return _sql
}

function rawDb(): Db {
  if (!_db) {
    _db = drizzle(rawSql(), { schema })
  }
  return _db
}

/**
 * The public Drizzle client. Every query goes through a Proxy that
 * transparently opens a transaction (so `SET LOCAL` works) and sets the
 * three RLS GUCs from the active AsyncLocalStorage context before running
 * the query.
 *
 * If there is no active context, the GUCs are set to empty/false — RLS
 * policies then evaluate to NULL (no rows) for tenant-scoped tables. Fail
 * closed.
 *
 * Callers must use `withTenant(...)` to establish context before calling
 * db.*. The migrate role (separate connection) bypasses this entirely.
 */
export const db: Db = new Proxy(rawDb(), {
  get(target, prop, receiver) {
    const original = Reflect.get(target, prop, receiver)
    // Forward `transaction` directly — callers that explicitly open one
    // already understand the contract.
    if (prop === 'transaction') return original
    if (typeof original !== 'function') return original
    return (...args: unknown[]) => {
      const ctx = getContext()
      const effectiveCtx = ctx ?? {
        tenantId: '00000000-0000-0000-0000-000000000000',
        userId: null,
        isSuperAdmin: false,
      }
      return rawDb().transaction(async (tx) => {
        for (const stmt of rlsSetLocalSql(effectiveCtx)) {
          await tx.execute(stmt)
        }
        return (original as (...a: unknown[]) => unknown).apply(tx, args)
      })
    }
  },
}) as Db

/**
 * Lower-level admin-style client that uses DATABASE_MIGRATE_URL. Used by
 * migrations and the ephemeral-DB test helper. NOT for app code.
 */
export function createMigrateClient(): Db {
  const url = process.env.DATABASE_MIGRATE_URL
  if (!url) {
    throw new Error(
      '[adapter-postgres] DATABASE_MIGRATE_URL is not set. See .env.example.',
    )
  }
  const client = postgres(url, { prepare: false, max: 2 })
  return drizzle(client, { schema })
}

export { schema }
