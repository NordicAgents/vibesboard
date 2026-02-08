import 'server-only'

import { isFeatureEnabled } from '@/lib/features'
import { type FeatureFlagName } from '@/lib/feature-flags'

export { FeatureGate } from './feature-gate-client'

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

