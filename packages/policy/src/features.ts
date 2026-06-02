/**
 * Per-tenant feature gating, backed by the `feature_flags` +
 * `tenant_feature_toggles` tables.
 *
 * Defaults: every feature is ON by default, EXCEPT the channel inboxes
 * (the `INBOX` flag and all of its descendants — WhatsApp / Instagram),
 * which are OFF by default so they don't appear automatically for every
 * workspace. Workspace admins can turn any flag on or off from the
 * tenant settings "Features" tab; those choices are stored as per-tenant
 * overrides and take precedence over the defaults.
 */

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  featureFlags,
  tenantFeatureToggles,
} from '@vibesboard/adapter-postgres/schema'
import {
  FEATURE_FLAG_NAMES,
  FEATURE_FLAG_DESCRIPTIONS,
  getAllDescendants,
  getFlagDepth,
  getParentFlag,
  type FeatureFlagName,
} from './feature-flags.ts'

export interface TenantFeatureStatus {
  id: string
  name: string
  description: string | null
  isEnabled: boolean
  isOverridden: boolean
  parentFlagName: string | null
  isDisabledByParent: boolean
  depth: number
}

/**
 * Flags that are OFF by default until a workspace admin enables them:
 *  - the `INBOX` parent and all of its descendants (WhatsApp / Instagram
 *    inbox + their auth sub-flags), so the channel sidebar sections don't
 *    appear automatically;
 *  - `AGENT_ACTIONS`, so agents can't take actions (calendar, etc.) unless
 *    explicitly turned on.
 */
const DISABLED_BY_DEFAULT: ReadonlySet<FeatureFlagName> =
  new Set<FeatureFlagName>([
    'INBOX',
    ...getAllDescendants('INBOX'),
    'AGENT_ACTIONS',
  ])

const KNOWN_FLAGS = new Set<string>(FEATURE_FLAG_NAMES)

/** Default enabled value for a flag, before any per-tenant override. */
function defaultValueFor(name: FeatureFlagName): boolean {
  return !DISABLED_BY_DEFAULT.has(name)
}

// The flag catalogue is static, so seeding only needs to happen once per
// process. The DB upsert is idempotent regardless, this just avoids the
// redundant write on every settings-page load.
let flagsEnsured = false

type Db = ReturnType<typeof getMigrateDb>

/**
 * Make sure every flag in the catalogue has a row in `feature_flags`.
 * Idempotent: existing rows (matched by unique name) are left untouched.
 */
async function ensureFeatureFlagRows(db: Db): Promise<void> {
  if (flagsEnsured) return
  await db
    .insert(featureFlags)
    .values(
      FEATURE_FLAG_NAMES.map((name) => ({
        id: randomUUID(),
        name,
        description: FEATURE_FLAG_DESCRIPTIONS[name] ?? null,
        defaultValue: defaultValueFor(name),
      })),
    )
    .onConflictDoNothing({ target: featureFlags.name })
  flagsEnsured = true
}

/**
 * Resolve the effective enabled state of a flag, honoring the parent
 * hierarchy: a flag is only enabled if its own value is true AND every
 * ancestor resolves to true.
 */
function resolveEnabled(
  name: FeatureFlagName,
  ownValue: ReadonlyMap<string, boolean>,
): boolean {
  if (ownValue.get(name) !== true) return false
  const parent = getParentFlag(name)
  if (parent && !resolveEnabled(parent, ownValue)) return false
  return true
}

/**
 * Build the map of each known flag's own value (per-tenant override if
 * present, otherwise the default) for a tenant.
 */
async function buildOwnValueMap(
  tenantId: string,
): Promise<Map<string, boolean>> {
  const own = new Map<string, boolean>()
  for (const name of FEATURE_FLAG_NAMES) own.set(name, defaultValueFor(name))

  const toggles = await getMigrateDb()
    .select({
      name: tenantFeatureToggles.featureFlagName,
      isEnabled: tenantFeatureToggles.isEnabled,
    })
    .from(tenantFeatureToggles)
    .where(eq(tenantFeatureToggles.tenantId, tenantId))

  for (const t of toggles) {
    if (KNOWN_FLAGS.has(t.name)) own.set(t.name, t.isEnabled)
  }
  return own
}

/**
 * Check if a feature is enabled for a specific tenant, accounting for the
 * tenant's overrides, the default, and the parent hierarchy.
 */
export async function isFeatureEnabled(
  tenantId: string,
  featureName: FeatureFlagName,
): Promise<boolean> {
  const own = await buildOwnValueMap(tenantId)
  return resolveEnabled(featureName, own)
}

/**
 * Get all enabled feature names for a tenant.
 */
export async function getEnabledFeatures(tenantId: string): Promise<string[]> {
  const own = await buildOwnValueMap(tenantId)
  return FEATURE_FLAG_NAMES.filter((name) => resolveEnabled(name, own))
}

/**
 * Get every feature with its per-tenant status, for the settings UI.
 * Ordered to match the flag catalogue, so parents precede their children.
 */
export async function getTenantFeatures(
  tenantId: string,
): Promise<TenantFeatureStatus[]> {
  const db = getMigrateDb()
  await ensureFeatureFlagRows(db)

  const [flags, toggles] = await Promise.all([
    db.select().from(featureFlags),
    db
      .select({
        name: tenantFeatureToggles.featureFlagName,
        isEnabled: tenantFeatureToggles.isEnabled,
      })
      .from(tenantFeatureToggles)
      .where(eq(tenantFeatureToggles.tenantId, tenantId)),
  ])

  const overrideByName = new Map<string, boolean>()
  for (const t of toggles) {
    if (KNOWN_FLAGS.has(t.name)) overrideByName.set(t.name, t.isEnabled)
  }

  const own = new Map<string, boolean>()
  for (const name of FEATURE_FLAG_NAMES) {
    own.set(
      name,
      overrideByName.has(name)
        ? (overrideByName.get(name) as boolean)
        : defaultValueFor(name),
    )
  }

  const idByName = new Map(flags.map((f) => [f.name, f]))

  return FEATURE_FLAG_NAMES.filter((name) => idByName.has(name)).map((name) => {
    const row = idByName.get(name)!
    const parent = getParentFlag(name)
    const parentEnabled = parent ? resolveEnabled(parent, own) : true
    return {
      id: row.id,
      name,
      description: row.description,
      isEnabled: resolveEnabled(name, own),
      isOverridden: overrideByName.has(name),
      parentFlagName: parent,
      isDisabledByParent: parent ? !parentEnabled : false,
      depth: getFlagDepth(name),
    }
  })
}

/**
 * Toggle a feature for a tenant. `featureFlagId` is the `feature_flags.id`
 * UUID supplied by the settings UI. Stores (or updates) a per-tenant
 * override row.
 */
export async function toggleFeature(
  tenantId: string,
  featureFlagId: string,
  isEnabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  const db = getMigrateDb()
  await ensureFeatureFlagRows(db)

  const [flag] = await db
    .select({ id: featureFlags.id, name: featureFlags.name })
    .from(featureFlags)
    .where(eq(featureFlags.id, featureFlagId))
    .limit(1)

  if (!flag) {
    return { success: false, error: 'Unknown feature flag' }
  }

  await db
    .insert(tenantFeatureToggles)
    .values({
      tenantId,
      featureFlagId: flag.id,
      featureFlagName: flag.name,
      isEnabled,
    })
    .onConflictDoUpdate({
      target: [tenantFeatureToggles.tenantId, tenantFeatureToggles.featureFlagId],
      set: { isEnabled, updatedAt: sql`now()` },
    })

  return { success: true }
}

/** Synchronous helpers used by some callers */
export function hasFeature(
  _tenantPlanId: string | null | undefined,
  _featureKey: string,
): boolean {
  return true
}

export function tenantHasFeature(_tenant: unknown, _featureKey: string): boolean {
  return true
}

export function featuresForPlan(_planId: string | null | undefined): string[] {
  return []
}
