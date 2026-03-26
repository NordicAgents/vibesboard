'use client'

import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FeatureToggleProps {
    id: string
    name: string
    description: string | null
    isEnabled: boolean
    isOverridden?: boolean
    isChild?: boolean
    isDisabledByParent?: boolean
    parentFlagName?: string | null
    onToggle: (id: string, enabled: boolean) => Promise<void>
    disabled?: boolean
}

export function FeatureToggle({
    id,
    name,
    description,
    isEnabled,
    isOverridden = false,
    isChild = false,
    isDisabledByParent = false,
    parentFlagName,
    onToggle,
    disabled = false
}: FeatureToggleProps) {
    const [loading, setLoading] = useState(false)
    const [checked, setChecked] = useState(isEnabled)

    useEffect(() => {
        setChecked(isEnabled)
    }, [isEnabled])

    const handleToggle = async (newValue: boolean) => {
        setLoading(true)
        setChecked(newValue)

        try {
            await onToggle(id, newValue)
        } catch (error) {
            // Revert on error
            setChecked(!newValue)
            console.error('Failed to toggle feature:', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div
            className={cn(
                'flex items-center justify-between space-x-4 rounded-lg border p-4',
                isChild && 'ml-6 border-l-2',
                isDisabledByParent && 'opacity-60'
            )}
        >
            <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                    <Label htmlFor={id} className="font-medium">
                        {name.replace(/_/g, ' ')}
                    </Label>
                    {isOverridden && !isDisabledByParent && (
                        <span className="text-xs text-muted-foreground">(Custom)</span>
                    )}
                    {isDisabledByParent && parentFlagName && (
                        <span className="text-xs text-muted-foreground">
                            (Requires {parentFlagName.replace(/_/g, ' ')})
                        </span>
                    )}
                </div>
                {description && (
                    <p className="text-sm text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            <Switch
                id={id}
                checked={checked}
                onCheckedChange={handleToggle}
                disabled={disabled || loading || isDisabledByParent}
            />
        </div>
    )
}
