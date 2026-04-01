'use client'

import { useState, useEffect, useCallback } from 'react'

interface TenantFeatureStatus {
  name: string
  isEnabled: boolean
}

/**
 * Hook to fetch all enabled features for a tenant in a single request.
 * Avoids N+1 feature gate API calls on pages with multiple feature-gated buttons.
 */
export function useTenantFeatures(tenantId: string | null) {
  const [features, setFeatures] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchFeatures = useCallback(async () => {
    if (!tenantId) {
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/tenants/${tenantId}/config`)
      if (res.ok) {
        const data = await res.json()
        const statuses: TenantFeatureStatus[] =
          data.tenant?.features || data.features || []
        const enabledNames = new Set<string>(
          statuses.filter((f) => f.isEnabled).map((f) => f.name)
        )
        setFeatures(enabledNames)
      }
    } catch (err) {
      console.error('Failed to fetch tenant features:', err)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    fetchFeatures()
  }, [fetchFeatures])

  const isEnabled = useCallback(
    (name: string) => features.has(name),
    [features]
  )

  return { features, loading, isEnabled }
}
