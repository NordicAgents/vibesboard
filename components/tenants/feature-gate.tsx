'use client'

import { useEffect, useState } from 'react'
import { isFeatureEnabled, type FeatureFlagName } from '@/lib/features'

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
        async function checkFeature() {
            setIsLoading(true)
            try {
                const enabled = await isFeatureEnabled(tenantId, feature)
                setIsEnabled(enabled)
            } catch (error) {
                console.error('Failed to check feature flag:', error)
                setIsEnabled(false)
            } finally {
                setIsLoading(false)
            }
        }

        checkFeature()
    }, [feature, tenantId])

    if (isLoading) {
        return <>{loadingFallback}</>
    }

    if (isEnabled) {
        return <>{children}</>
    }

    return <>{fallback}</>
}

// Server-side version for use in server components
export async function ServerFeatureGate({
    feature,
    tenantId,
    children,
    fallback = null
}: Omit<FeatureGateProps, 'loadingFallback'>) {
    const enabled = await isFeatureEnabled(tenantId, feature)

    if (enabled) {
        return <>{children}</>
    }

    return <>{fallback}</>
}
