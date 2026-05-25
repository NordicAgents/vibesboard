import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenants } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/** Returns the tenant's Google Place ID, or null if unset or the tenant is missing. */
export async function getTenantGooglePlaceId(
  tenantId: string,
  db: Db,
): Promise<string | null> {
  const [row] = await db
    .select({ googlePlaceId: tenants.googlePlaceId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return row?.googlePlaceId ?? null
}

/** Persists (or clears, when null) the tenant's Google Place ID. */
export async function setTenantGooglePlaceId(
  tenantId: string,
  googlePlaceId: string | null,
  db: Db,
): Promise<void> {
  await db
    .update(tenants)
    .set({ googlePlaceId, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
}

/** Returns whether the tenant is a personal workspace, or null if the tenant is missing. */
export async function getTenantIsPersonal(
  tenantId: string,
  db: Db,
): Promise<boolean | null> {
  const [row] = await db
    .select({ isPersonal: tenants.isPersonal })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return row?.isPersonal ?? null
}
