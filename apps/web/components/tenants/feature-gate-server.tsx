import 'server-only'

import { isFeatureEnabled } from '@vibesboard/policy/features'
import { type FeatureFlagName } from '@vibesboard/policy/feature-flags'

interface ServerFeatureGateProps {
  feature: FeatureFlagName
  tenantId: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export async function ServerFeatureGate({
  feature,
  tenantId,
  children,
  fallback = null
}: ServerFeatureGateProps) {
  const enabled = await isFeatureEnabled(tenantId, feature)

  if (enabled) {
    return <>{children}</>
  }

  return <>{fallback}</>
}
