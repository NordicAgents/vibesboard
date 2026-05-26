import { sql, type SQL } from 'drizzle-orm'
import type { TenantContext } from './tenant-context.ts'

/**
 * Build the SQL needed to apply tenant context to the current transaction.
 * Caller is responsible for executing this inside an active transaction.
 *
 * `set_config(name, value, true)` is `SET LOCAL` for the current
 * transaction — same effect as `SET LOCAL …` but accepts a parameter
 * binding for the value, which `SET LOCAL` does not.
 */
export function rlsSetLocalSql(ctx: TenantContext): SQL[] {
  return [
    sql`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`,
    sql`SELECT set_config('app.current_user_id', ${ctx.userId ?? ''}, true)`,
    sql`SELECT set_config('app.is_super_admin', ${ctx.isSuperAdmin ? 'true' : 'false'}, true)`,
  ]
}
