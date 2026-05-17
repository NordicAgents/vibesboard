'use client'

import { useEffect, useState } from 'react'
import { type FeatureFlagName } from '@/lib/feature-flags'

interface FeatureGateProps {
  feature: FeatureFlagName
  tenantId: string
  children: React.ReactNode
  fallback?: React.ReactNode
  loadingFallback?: React.ReactNode
}

export function FeatureGate({
  feature,
  tenantId,
  children,
  fallback = null,
  loadingFallback = null
}: FeatureGateProps) {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function checkFeature() {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/tenants/${tenantId}/config`, {
          signal: controller.signal
        })

        if (!response.ok) {
          setIsEnabled(false)
          return
        }

        const data = await response.json()
        const features = (data?.features ??
          data?.tenant?.features ??
          []) as Array<{ name: string; isEnabled: boolean }>

        const found = features.find(f => f.name === feature)
        setIsEnabled(Boolean(found?.isEnabled))
      } catch (error) {
        if ((error as any)?.name === 'AbortError') {
          return
        }
        console.error('Failed to check feature flag:', error)
        setIsEnabled(false)
      } finally {
        setIsLoading(false)
      }
    }

    checkFeature()
    return () => controller.abort()
  }, [feature, tenantId])

  if (isLoading) {
    return <>{loadingFallback}</>
  }

  if (isEnabled) {
    return <>{children}</>
  }

  return <>{fallback}</>
}
