/**
 * Per-tenant feature gating for the self-host stack.
 *
 * Effective state = tenant override (tenant_feature_toggles) ?? code default
 * (FEATURE_FLAG_DEFAULTS), with parent-hierarchy cascade: if a parent flag is
 * off, every descendant is off regardless of its own value.
 *
 * Data access goes through getMigrateDb() — feature_flags and
 * tenant_feature_toggles have no RLS and the app role has no grants on them,
 * so they're read/written via the migrate role (the same role Better Auth's
 * identity layer uses for non-tenant-scoped tables).
 */
import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getMigrateDb } from "@vibesboard/adapter-postgres/client";
import * as schema from "@vibesboard/adapter-postgres/schema";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_NAMES,
  getParentFlag,
  getFlagDepth,
  type FeatureFlagName,
} from "./feature-flags.ts";

export interface TenantFeatureStatus {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  isOverridden: boolean;
  parentFlagName: string | null;
  isDisabledByParent: boolean;
  depth: number;
}

function defaultFor(name: FeatureFlagName): boolean {
  return FEATURE_FLAG_DEFAULTS[name] ?? true;
}

/**
 * Load every tenant override as name → isEnabled. Read by tenant id; the toggle
 * table carries featureFlagName, so no join against feature_flags is needed.
 */
async function loadOverrides(tenantId: string): Promise<Map<string, boolean>> {
  const rows = await getMigrateDb()
    .select({
      name: schema.tenantFeatureToggles.featureFlagName,
      isEnabled: schema.tenantFeatureToggles.isEnabled,
    })
    .from(schema.tenantFeatureToggles)
    .where(eq(schema.tenantFeatureToggles.tenantId, tenantId));
  return new Map(rows.map((r) => [r.name, r.isEnabled]));
}

/** Effective enabled state for one flag given a preloaded override map. */
function effectiveEnabled(
  name: FeatureFlagName,
  overrides: Map<string, boolean>,
): boolean {
  const own = overrides.has(name) ? overrides.get(name)! : defaultFor(name);
  if (!own) return false;
  const parent = getParentFlag(name);
  if (parent) return effectiveEnabled(parent, overrides);
  return true;
}

/**
 * Check if a feature is enabled for a specific tenant. Honours per-tenant
 * overrides and the parent-child hierarchy (a disabled parent disables children).
 */
export async function isFeatureEnabled(
  tenantId: string,
  featureName: FeatureFlagName,
): Promise<boolean> {
  if (!tenantId) return false;
  const overrides = await loadOverrides(tenantId);
  return effectiveEnabled(featureName, overrides);
}

/**
 * All effectively-enabled feature names for a tenant (hierarchy respected).
 */
export async function getEnabledFeatures(tenantId: string): Promise<string[]> {
  if (!tenantId) return [];
  const overrides = await loadOverrides(tenantId);
  return FEATURE_FLAG_NAMES.filter((name) => effectiveEnabled(name, overrides));
}

/**
 * All features with status + hierarchy metadata for the per-tenant admin UI.
 * Joins the seeded feature_flags registry (for ids/descriptions) with the
 * tenant's overrides; flags absent from the registry still appear using code
 * defaults so the UI never silently drops a known capability.
 */
export async function getTenantFeatures(
  tenantId: string,
): Promise<TenantFeatureStatus[]> {
  if (!tenantId) return [];

  const [flags, overrides] = await Promise.all([
    getMigrateDb()
      .select({
        id: schema.featureFlags.id,
        name: schema.featureFlags.name,
        description: schema.featureFlags.description,
      })
      .from(schema.featureFlags),
    loadOverrides(tenantId),
  ]);

  const flagByName = new Map(flags.map((f) => [f.name, f]));

  const statuses: TenantFeatureStatus[] = FEATURE_FLAG_NAMES.map((name) => {
    const registry = flagByName.get(name);
    const own = overrides.has(name) ? overrides.get(name)! : defaultFor(name);
    return {
      id: registry?.id ?? name,
      name,
      description: registry?.description ?? null,
      isEnabled: own,
      isOverridden: overrides.has(name),
      parentFlagName: getParentFlag(name),
      isDisabledByParent: false,
      depth: getFlagDepth(name),
    };
  });

  // Resolve cascade: shallowest first so disabled parents propagate down.
  const enabledByName = new Map(statuses.map((s) => [s.name, s.isEnabled]));
  for (const status of [...statuses].sort((a, b) => a.depth - b.depth)) {
    const parent = status.parentFlagName;
    if (parent && !enabledByName.get(parent)) {
      status.isDisabledByParent = true;
      status.isEnabled = false;
      enabledByName.set(status.name, false);
    }
  }

  return statuses;
}

/**
 * Resolve a flag by id (seeded registry) or by name, creating the registry row
 * on demand for a known flag name that has none yet.
 *
 * Why both: getTenantFeatures falls back to `id: name` when the registry has no
 * row, so the UI may call toggleFeature with a flag NAME rather than a uuid on a
 * database that was never seeded with db:seed-flags. Since
 * tenant_feature_toggles.featureFlagId is an FK into feature_flags, a toggle is
 * impossible without a registry row — so for a known flag we create it here
 * idempotently. This makes the toggle path self-healing on deployed databases
 * (addresses "admins can't enable channels until someone runs seed out-of-band").
 */
async function resolveOrCreateFlag(
  idOrName: string,
): Promise<{ id: string; name: string } | null> {
  const db = getMigrateDb();
  const isKnownName = (FEATURE_FLAG_NAMES as readonly string[]).includes(
    idOrName,
  );

  if (!isKnownName) {
    // Treat as a real feature_flags.id (uuid) from a seeded registry. An
    // unknown, non-name string simply matches nothing → "Unknown feature flag".
    const [byId] = await db
      .select({ id: schema.featureFlags.id, name: schema.featureFlags.name })
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.id, idOrName))
      .limit(1);
    return byId ?? null;
  }

  const name = idOrName as FeatureFlagName;
  const [existing] = await db
    .select({ id: schema.featureFlags.id, name: schema.featureFlags.name })
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.name, name))
    .limit(1);
  if (existing) return existing;

  // Create on demand; onConflictDoNothing makes this safe under a concurrent
  // toggle or a later db:seed-flags run (feature_flags.name is unique).
  await db
    .insert(schema.featureFlags)
    .values({
      id: uuidv7(),
      name,
      description: null,
      defaultValue: FEATURE_FLAG_DEFAULTS[name] ?? true,
    })
    .onConflictDoNothing({ target: schema.featureFlags.name });

  const [created] = await db
    .select({ id: schema.featureFlags.id, name: schema.featureFlags.name })
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.name, name))
    .limit(1);
  return created ?? null;
}

/**
 * Set a per-tenant override. Accepts the flag's registry id OR its name (see
 * resolveOrCreateFlag); the registry row is created on demand for a known flag
 * so this works even on a database that was never seeded with db:seed-flags.
 */
export async function toggleFeature(
  tenantId: string,
  featureFlagIdOrName: string,
  isEnabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId) return { success: false, error: "Missing tenant" };

  const flag = await resolveOrCreateFlag(featureFlagIdOrName);
  if (!flag) return { success: false, error: "Unknown feature flag" };

  await getMigrateDb()
    .insert(schema.tenantFeatureToggles)
    .values({
      tenantId,
      featureFlagId: flag.id,
      featureFlagName: flag.name,
      isEnabled,
    })
    .onConflictDoUpdate({
      target: [
        schema.tenantFeatureToggles.tenantId,
        schema.tenantFeatureToggles.featureFlagId,
      ],
      set: { isEnabled, updatedAt: new Date() },
    });

  return { success: true };
}

/** Synchronous helpers used by some callers — kept permissive (plan-agnostic). */
export function hasFeature(
  _tenantPlanId: string | null | undefined,
  _featureKey: string,
): boolean {
  return true;
}

export function tenantHasFeature(
  _tenant: unknown,
  _featureKey: string,
): boolean {
  return true;
}

export function featuresForPlan(_planId: string | null | undefined): string[] {
  return [];
}
