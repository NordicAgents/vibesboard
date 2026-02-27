import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { type FeatureFlagName } from '@/lib/feature-flags'

/**
 * Check if a feature is enabled for a specific tenant
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

  if (toggleDoc.exists) {
    return toggleDoc.data()?.isEnabled ?? flag.defaultValue
  }

  return flag.defaultValue
}

/**
 * Get all enabled features for a tenant
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
  togglesSnapshot.docs.forEach(doc => {
    toggleMap.set(doc.id, doc.data().isEnabled)
  })

  const enabledFeatures: string[] = []

  for (const doc of flagsSnapshot.docs) {
    const flag = doc.data()
    const override = toggleMap.get(doc.id)
    const isEnabled = override !== undefined ? override : flag.defaultValue

    if (isEnabled) {
      enabledFeatures.push(flag.name)
    }
  }

  return enabledFeatures
}

/**
 * Get all features with their status for a tenant
 */
export async function getTenantFeatures(
  tenantId: string
): Promise<
  Array<{
    id: string
    name: string
    description: string | null
    isEnabled: boolean
    isOverridden: boolean
  }>
> {
  const flagsSnapshot = await adminDb
    .collection(Collections.featureFlags)
    .get()

  if (flagsSnapshot.empty) return []

  const togglesSnapshot = await adminDb
    .collection(Collections.featureToggles(tenantId))
    .get()

  const toggleMap = new Map<string, boolean>()
  togglesSnapshot.docs.forEach(doc => {
    toggleMap.set(doc.id, doc.data().isEnabled)
  })

  return flagsSnapshot.docs.map(doc => {
    const flag = doc.data()
    const override = toggleMap.get(doc.id)

    return {
      id: doc.id,
      name: flag.name,
      description: flag.description ?? null,
      isEnabled: override !== undefined ? override : flag.defaultValue,
      isOverridden: override !== undefined
    }
  })
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
