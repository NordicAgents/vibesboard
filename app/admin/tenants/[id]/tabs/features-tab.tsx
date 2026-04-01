'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FeatureToggle } from '@/components/tenants'
import toast from 'react-hot-toast'

interface TenantFeaturesTabProps {
    tenantId: string
}

interface TenantFeatureStatus {
    id: string
    name: string
    description: string | null
    isEnabled: boolean
    isOverridden: boolean
    parentFlagName: string | null
    isDisabledByParent: boolean
    depth: number
}

export function TenantFeaturesTab({ tenantId }: TenantFeaturesTabProps) {
    const [features, setFeatures] = React.useState<TenantFeatureStatus[]>([])
    const [loading, setLoading] = React.useState(true)

    const fetchFeatures = React.useCallback(async () => {
        try {
            setLoading(true)

            // Fetch tenant configuration
            const configResponse = await fetch(`/api/tenants/${tenantId}/config`)
            if (!configResponse.ok) throw new Error('Failed to fetch tenant config')
            const configData = await configResponse.json()

            const statuses: TenantFeatureStatus[] =
                configData.tenant?.features || configData.features || []
            setFeatures(statuses)
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
                const data = await response.json().catch(() => ({}))
                throw new Error(data.error || 'Failed to toggle feature')
            }

            // Optimistically update UI — cascade through all descendants
            setFeatures((prev) => {
                const toggled = prev.find((f) => f.id === featureId)
                if (!toggled) return prev

                // Collect all descendant names recursively
                const getDescendantNames = (parentName: string): Set<string> => {
                    const names = new Set<string>()
                    for (const f of prev) {
                        if (f.parentFlagName === parentName) {
                            names.add(f.name)
                            for (const n of getDescendantNames(f.name)) {
                                names.add(n)
                            }
                        }
                    }
                    return names
                }
                const descendants = getDescendantNames(toggled.name)

                return prev.map((f) => {
                    // Update the toggled feature
                    if (f.id === featureId) {
                        return { ...f, isEnabled: enabled, isOverridden: true }
                    }
                    // If toggling OFF, cascade disable to all descendants
                    if (!enabled && descendants.has(f.name)) {
                        return { ...f, isDisabledByParent: true }
                    }
                    // If toggling ON, un-cascade direct children only
                    if (enabled && f.parentFlagName === toggled.name) {
                        return { ...f, isDisabledByParent: false }
                    }
                    return f
                })
            })

            toast.success('Feature updated successfully')
        } catch (error) {
            console.error('Error toggling feature:', error)
            toast.error(error instanceof Error ? error.message : 'Failed to toggle feature')
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
                            isEnabled={feature.isEnabled}
                            isOverridden={feature.isOverridden}
                            depth={feature.depth}
                            isDisabledByParent={feature.isDisabledByParent}
                            parentFlagName={feature.parentFlagName}
                            onToggle={async (id, enabled) => await handleToggle(id, enabled)}
                        />
                    ))
                )}
            </CardContent>
        </Card>
    )
}
