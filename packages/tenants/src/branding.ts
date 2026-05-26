import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenantBranding, platformBranding } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

export type BrandingField = 'logoUrl' | 'primaryColor' | 'secondaryColor'

export interface PlatformBranding {
  primaryColor: string
  secondaryColor: string
  logoUrl?: string
}

/** Used when no platform_branding row exists yet. */
export const PLATFORM_BRANDING_FALLBACK: PlatformBranding = {
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  logoUrl: undefined,
}

export interface TenantBrandingRow {
  tenantId: string
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  overrides: BrandingField[] | null
}

export interface UpsertTenantBrandingInput {
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  overrides: BrandingField[]
}

/** Platform-wide base branding (singleton table; one row). */
export async function getPlatformBranding(db: Db): Promise<PlatformBranding> {
  const rows = await db.select().from(platformBranding).limit(1)
  if (rows.length === 0) return PLATFORM_BRANDING_FALLBACK
  return {
    primaryColor: rows[0].primaryColor,
    secondaryColor: rows[0].secondaryColor,
    logoUrl: rows[0].logoUrl ?? undefined,
  }
}

/** A tenant's branding row, or null if it has none. */
export async function getTenantBranding(
  db: Db,
  tenantId: string,
): Promise<TenantBrandingRow | null> {
  const rows = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1)
  if (rows.length === 0) return null
  return {
    tenantId: rows[0].tenantId,
    logoUrl: rows[0].logoUrl,
    primaryColor: rows[0].primaryColor,
    secondaryColor: rows[0].secondaryColor,
    overrides: rows[0].overrides ?? null,
  }
}

/** Fixed sentinel id for the platform_branding singleton row. */
export const PLATFORM_BRANDING_ID = '00000000-0000-0000-0000-000000000001'

export interface UpsertPlatformBrandingInput {
  primaryColor: string
  secondaryColor: string
  logoUrl: string | null
  updatedBy: string | null
}

/** Insert or update the platform branding singleton (fixed sentinel id). */
export async function upsertPlatformBranding(
  db: Db,
  input: UpsertPlatformBrandingInput,
): Promise<void> {
  await db
    .insert(platformBranding)
    .values({
      id: PLATFORM_BRANDING_ID,
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      logoUrl: input.logoUrl,
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformBranding.id,
      set: {
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        logoUrl: input.logoUrl,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
}

/** Insert or update a tenant's branding (keyed by tenant_id). */
export async function upsertTenantBranding(
  db: Db,
  tenantId: string,
  input: UpsertTenantBrandingInput,
): Promise<void> {
  await db
    .insert(tenantBranding)
    .values({
      tenantId,
      logoUrl: input.logoUrl,
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      overrides: input.overrides,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: {
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        overrides: input.overrides,
        updatedAt: new Date(),
      },
    })
}
