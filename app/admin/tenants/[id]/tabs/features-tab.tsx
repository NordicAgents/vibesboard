'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FeatureToggle } from '@/components/tenants'
import { Database } from '@/lib/db_types'
import toast from 'react-hot-toast'

type FeatureFlag = Database['public']['Tables']['feature_flags']['Row']
type TenantFeatureToggle = Database['public']['Tables']['tenant_feature_toggles']['Row']

interface TenantFeaturesTabProps {
    tenantId: string
}

interface FeatureWithToggle extends FeatureFlag {
    tenant_override?: boolean
    is_enabled: boolean
}

export function TenantFeaturesTab({ tenantId }: TenantFeaturesTabProps) {
    const [features, setFeatures] = React.useState<FeatureWithToggle[]>([])
    const [loading, setLoading] = React.useState(true)

    const fetchFeatures = React.useCallback(async () => {
        try {
            setLoading(true)

            // Fetch all feature flags
            const flagsResponse = await fetch('/api/admin/feature-flags')
            if (!flagsResponse.ok) throw new Error('Failed to fetch feature flags')
            const flagsData = await flagsResponse.json()

            // Fetch tenant configuration
            const configResponse = await fetch(`/api/tenants/${tenantId}/config`)
            if (!configResponse.ok) throw new Error('Failed to fetch tenant config')
            const configData = await configResponse.json()

            // Merge feature flags with tenant toggles
            const mergedFeatures: FeatureWithToggle[] = flagsData.flags.map(
                (flag: FeatureFlag) => {
                    const toggle = configData.features?.find(
                        (f: TenantFeatureToggle) => f.feature_flag_id === flag.id
                    )
                    return {
                        ...flag,
                        tenant_override: toggle !== undefined,
                        is_enabled: toggle ? toggle.is_enabled : flag.default_value,
                    }
                }
            )

            setFeatures(mergedFeatures)
        } catch (error) {
            console.error('Error fetching features:', error)
            toast.error('Failed to load features')
        } finally {
            setLoading(false)
        }
    }, [tenantId])

    React.useEffect(() => {
        fetchFeatures()
    }, [fetchFeatures])

    const handleToggle = async (featureId: string, enabled: boolean) => {
        try {
            const response = await fetch(`/api/tenants/${tenantId}/features`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    feature_flag_id: featureId,
                    is_enabled: enabled,
                }),
            })

            if (!response.ok) {
                throw new Error('Failed to toggle feature')
            }

            // Optimistically update UI
            setFeatures((prev) =>
                prev.map((f) =>
                    f.id === featureId
                        ? { ...f, is_enabled: enabled, tenant_override: true }
                        : f
                )
            )

            toast.success('Feature updated successfully')
        } catch (error) {
            console.error('Error toggling feature:', error)
            toast.error('Failed to toggle feature')
            // Revert on error
            fetchFeatures()
        }
    }

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Feature Flags</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="h-16 animate-pulse rounded bg-muted" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Feature Flags</CardTitle>
                <CardDescription>
                    Enable or disable features for this tenant
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {features.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No feature flags available</p>
                ) : (
                    features.map((feature) => (
                        <FeatureToggle
                            key={feature.id}
                            id={feature.id}
                            name={feature.name}
                            description={feature.description}
                            isEnabled={feature.is_enabled}
                            isOverridden={feature.tenant_override}
                            onToggle={async (id, enabled) => await handleToggle(id, enabled)}
                        />
                    ))
                )}
            </CardContent>
        </Card>
    )
}
