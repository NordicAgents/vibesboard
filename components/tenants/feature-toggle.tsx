'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface FeatureToggleProps {
 id: string
 name: string
 description: string | null
 isEnabled: boolean
 isOverridden?: boolean
 onToggle: (id: string, enabled: boolean) => Promise<void>
 disabled?: boolean
}

export function FeatureToggle({
 id,
 name,
 description,
 isEnabled,
 isOverridden = false,
 onToggle,
 disabled = false
}: FeatureToggleProps) {
 const [loading, setLoading] = useState(false)
 const [checked, setChecked] = useState(isEnabled)

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
 <div className="flex items-center justify-between space-x-4 rounded-lg border p-4">
 <div className="flex-1 space-y-1">
 <div className="flex items-center gap-2">
 <Label htmlFor={id} className="font-medium">
 {name.replace(/_/g, ' ')}
 </Label>
 {isOverridden && (
 <span className="text-xs text-muted-foreground">(Custom)</span>
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
 disabled={disabled || loading}
 />
 </div>
 )
}
