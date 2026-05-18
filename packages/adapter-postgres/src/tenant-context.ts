import { AsyncLocalStorage } from 'node:async_hooks'

export type TenantContext = {
  /** Active tenant. Required — RLS policies depend on this. */
  tenantId: string
  /** Active user. `null` for anonymous public-agent traffic. */
  userId: string | null
  /** When true, RLS policies grant cross-tenant visibility (super-admin). */
  isSuperAdmin: boolean
}

const als = new AsyncLocalStorage<TenantContext>()

export function getContext(): TenantContext | undefined {
  return als.getStore()
}

/**
 * Run `fn` inside a tenant-scoped context. Every database call made (directly
 * or transitively) from within `fn` will execute under this context, with
 * Postgres GUCs set so RLS policies enforce isolation.
 *
 * Nested calls override the outer context for the inner scope and restore
 * the outer context on exit. Parallel calls keep their contexts isolated.
 */
export async function withTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn)
}
