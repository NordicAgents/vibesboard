import 'server-only'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'

/**
 * Sync a tenant's feature toggles based on their plan's featureFlags array.
 * Called when a tenant's plan is changed via the admin UI.
 *
 * - Flags in the plan: enabled
 * - Flags not in the plan: disabled
 */
export async function syncTenantFeatureFlags(
  tenantId: string,
  planFeatureFlags: string[]
): Promise<void> {
  const planFlagSet = new Set(planFeatureFlags)

  // Fetch all global feature flags
  const flagsSnap = await adminDb.collection(Collections.featureFlags).get()

  if (flagsSnap.empty) return

  const batch = adminDb.batch()
  const now = new Date().toISOString()
  const togglesCol = Collections.featureToggles(tenantId)

  for (const flagDoc of flagsSnap.docs) {
    const flag = flagDoc.data()
    const flagName = flag.name as string
    const isEnabled = planFlagSet.has(flagName)

    const toggleRef = adminDb.collection(togglesCol).doc(flagDoc.id)
    batch.set(
      toggleRef,
      {
        tenantId,
        featureFlagId: flagDoc.id,
        featureFlagName: flagName,
        isEnabled,
        updatedAt: now,
        createdAt: now
      },
      { merge: true }
    )
  }

  await batch.commit()
}
