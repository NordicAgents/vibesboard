'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import toast from 'react-hot-toast'

interface CreateFeatureFlagDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
}

export function CreateFeatureFlagDialog({
    open,
    onOpenChange,
    onSuccess
}: CreateFeatureFlagDialogProps) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [defaultValue, setDefaultValue] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [nameError, setNameError] = useState('')

    const validateName = (value: string) => {
        // Must be uppercase with underscores
        const regex = /^[A-Z][A-Z0-9_]*$/
        if (!value) {
            setNameError('Name is required')
            return false
        }
        if (!regex.test(value)) {
            setNameError('Name must be UPPERCASE_SNAKE_CASE (letters, numbers, underscores)')
            return false
        }
        setNameError('')
        return true
    }

    const handleNameChange = (value: string) => {
        setName(value)
        if (value) {
            validateName(value)
        } else {
            setNameError('')
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!validateName(name)) {
            return
        }

        setIsLoading(true)

        try {
            const response = await fetch('/api/admin/feature-flags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description: description || null,
                    default_value: defaultValue
                })
            })

            const data = await response.json()

            if (response.ok) {
                toast.success('Feature flag created successfully')
                resetForm()
                onSuccess?.()
            } else {
                toast.error(data.error || 'Failed to create feature flag')
            }
        } catch (error) {
            console.error('Error creating feature flag:', error)
            toast.error('Failed to create feature flag')
        } finally {
            setIsLoading(false)
        }
    }

    const resetForm = () => {
        setName('')
        setDescription('')
        setDefaultValue(false)
        setNameError('')
    }

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen && !isLoading) {
            resetForm()
        }
        onOpenChange(newOpen)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Create Feature Flag</DialogTitle>
                        <DialogDescription>
                            Create a new feature flag that can be toggled per tenant
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">
                                Name <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="name"
                                placeholder="ADVANCED_ANALYTICS"
                                value={name}
                                onChange={(e) => handleNameChange(e.target.value.toUpperCase())}
                                disabled={isLoading}
                                autoFocus
                                className={nameError ? 'border-destructive' : ''}
                            />
                            {nameError && (
                                <p className="text-sm text-destructive">{nameError}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Use UPPERCASE_SNAKE_CASE format (e.g., CUSTOM_BRANDING)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                                id="description"
                                placeholder="Enables advanced analytics features..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={isLoading}
                                rows={3}
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="default-value" className="text-base">
                                    Default Value
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Enable this feature by default for new tenants
                                </p>
                            </div>
                            <Switch
                                id="default-value"
                                checked={defaultValue}
                                onCheckedChange={setDefaultValue}
                                disabled={isLoading}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleOpenChange(false)}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading || !!nameError}>
                            {isLoading ? 'Creating...' : 'Create Feature Flag'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
