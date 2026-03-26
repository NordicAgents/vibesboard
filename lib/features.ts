import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { type FeatureFlagName, getParentFlag } from '@/lib/feature-flags'

export interface TenantFeatureStatus {
  id: string
  name: string
  description: string | null
  isEnabled: boolean
  isOverridden: boolean
  parentFlagName: string | null
  isDisabledByParent: boolean
}

/**
 * Check if a feature is enabled for a specific tenant.
 * Automatically checks parent flags — if a parent is disabled,
 * the child is disabled regardless of its own toggle.
 */
export async function isFeatureEnabled(
  tenantId: string,
  featureName: FeatureFlagName
): Promise<boolean> {
  // Get global feature flag by name
  const flagsSnapshot = await adminDb
    .collection(Collections.featureFlags)
    .where('name', '==', featureName)
    .limit(1)
    .get()

  if (flagsSnapshot.empty) return false
  const flag = flagsSnapshot.docs[0].data()

  // Check for tenant-specific override
  const toggleDoc = await adminDb
    .collection(Collections.featureToggles(tenantId))
    .doc(flagsSnapshot.docs[0].id)
    .get()

  const ownEnabled = toggleDoc.exists
    ? (toggleDoc.data()?.isEnabled ?? flag.defaultValue)
    : flag.defaultValue

  if (!ownEnabled) return false

  // Check parent flag — if parent is disabled, child is disabled
  const parentFlagName = getParentFlag(featureName)
  if (parentFlagName) {
    const parentEnabled = await isFeatureEnabled(tenantId, parentFlagName)
    if (!parentEnabled) return false
  }

  return true
}

/**
 * Get all enabled features for a tenant.
 * Respects parent-child hierarchy.
 */
export async function getEnabledFeatures(
  tenantId: string
): Promise<string[]> {
  // Get all feature flags
  const flagsSnapshot = await adminDb
    .collection(Collections.featureFlags)
    .get()

  if (flagsSnapshot.empty) return []

  // Get tenant-specific toggles
  const togglesSnapshot = await adminDb
    .collection(Collections.featureToggles(tenantId))
    .get()

  const toggleMap = new Map<string, boolean>()
  togglesSnapshot.docs.forEach((doc: any) => {
    toggleMap.set(doc.id, doc.data().isEnabled)
  })

  // Build a name→enabled map for parent lookups
  const enabledMap = new Map<string, boolean>()
  for (const doc of flagsSnapshot.docs) {
    const flag = doc.data()
    const override = toggleMap.get(doc.id)
    enabledMap.set(flag.name, override !== undefined ? override : flag.defaultValue)
  }

  // Filter: include only if enabled AND parent (if any) is also enabled
  const enabledFeatures: string[] = []
  for (const [name, enabled] of enabledMap) {
    if (!enabled) continue
    const parent = getParentFlag(name as FeatureFlagName)
    if (parent && !enabledMap.get(parent)) continue
    enabledFeatures.push(name)
  }

  return enabledFeatures
}

/**
 * Get all features with their status for a tenant.
 * Includes hierarchy metadata for UI rendering.
 */
export async function getTenantFeatures(
  tenantId: string
): Promise<TenantFeatureStatus[]> {
  const flagsSnapshot = await adminDb
    .collection(Collections.featureFlags)
    .get()

  if (flagsSnapshot.empty) return []

  const togglesSnapshot = await adminDb
    .collection(Collections.featureToggles(tenantId))
    .get()

  const toggleMap = new Map<string, boolean>()
  togglesSnapshot.docs.forEach((doc: any) => {
    toggleMap.set(doc.id, doc.data().isEnabled)
  })

  // First pass: compute own enabled status for each flag
  const features: TenantFeatureStatus[] = flagsSnapshot.docs.map((doc: any) => {
    const flag = doc.data()
    const override = toggleMap.get(doc.id)
    const parentFlagName = getParentFlag(flag.name as FeatureFlagName)

    return {
      id: doc.id,
      name: flag.name,
      description: flag.description ?? null,
      isEnabled: override !== undefined ? override : flag.defaultValue,
      isOverridden: override !== undefined,
      parentFlagName: parentFlagName,
      isDisabledByParent: false, // computed in second pass
    }
  })

  // Build name→enabled lookup for parent checks
  const enabledByName = new Map<string, boolean>()
  for (const f of features) {
    enabledByName.set(f.name, f.isEnabled)
  }

  // Second pass: compute isDisabledByParent and effective isEnabled
  for (const f of features) {
    if (f.parentFlagName) {
      const parentEnabled = enabledByName.get(f.parentFlagName) ?? false
      if (!parentEnabled) {
        f.isDisabledByParent = true
        f.isEnabled = false
      }
    }
  }

  // Sort: parents before children, then alphabetical
  features.sort((a, b) => {
    // If a is parent of b, a comes first
    if (b.parentFlagName === a.name) return -1
    if (a.parentFlagName === b.name) return 1
    // Group children with their parent
    const aGroup = a.parentFlagName ?? a.name
    const bGroup = b.parentFlagName ?? b.name
    if (aGroup !== bGroup) return aGroup.localeCompare(bGroup)
    // Parent before child within same group
    if (a.parentFlagName && !b.parentFlagName) return 1
    if (!a.parentFlagName && b.parentFlagName) return -1
    return a.name.localeCompare(b.name)
  })

  return features
}

/**
 * Toggle a feature for a tenant
 */
export async function toggleFeature(
  tenantId: string,
  featureFlagId: string,
  isEnabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get flag name for denormalization
    const flagDoc = await adminDb
      .collection(Collections.featureFlags)
      .doc(featureFlagId)
      .get()

    const flagName = flagDoc.exists ? flagDoc.data()?.name : ''

    await adminDb
      .collection(Collections.featureToggles(tenantId))
      .doc(featureFlagId)
      .set(
        {
          tenantId,
          featureFlagId,
          featureFlagName: flagName,
          isEnabled,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        },
        { merge: true }
      )

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message }
  }
}
