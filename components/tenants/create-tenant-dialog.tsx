'use client'

import * as React from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validateTenantSlug, validateTenantName, generateSlug } from '@/lib/validations'
import toast from 'react-hot-toast'

interface CreateTenantDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
}

export function CreateTenantDialog({
    open,
    onOpenChange,
    onSuccess,
}: CreateTenantDialogProps) {
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [slugManuallyEdited, setSlugManuallyEdited] = React.useState(false)
    const [formData, setFormData] = React.useState({
        name: '',
        slug: '',
    })
    const [errors, setErrors] = React.useState({
        name: '',
        slug: '',
    })

    // Auto-generate slug from name
    React.useEffect(() => {
        if (!slugManuallyEdited && formData.name) {
            setFormData((prev) => ({
                ...prev,
                slug: generateSlug(formData.name),
            }))
        }
    }, [formData.name, slugManuallyEdited])

    const validate = () => {
        const newErrors = { name: '', slug: '' }
        let isValid = true

        if (!formData.name || formData.name.length < 3) {
            newErrors.name = 'Name must be at least 3 characters'
            isValid = false
        } else if (!validateTenantName(formData.name)) {
            newErrors.name = 'Invalid tenant name'
            isValid = false
        }

        if (!formData.slug || formData.slug.length < 3) {
            newErrors.slug = 'Slug must be at least 3 characters'
            isValid = false
        } else if (!validateTenantSlug(formData.slug)) {
            newErrors.slug = 'Slug must be lowercase letters, numbers, and hyphens only'
            isValid = false
        }

        setErrors(newErrors)
        return isValid
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!validate()) {
            return
        }

        try {
            setIsSubmitting(true)

            const response = await fetch('/api/admin/tenants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to create tenant')
            }

            toast.success('Tenant created successfully')
            handleClose()
            onSuccess?.()
        } catch (error) {
            console.error('Error creating tenant:', error)
            toast.error(error instanceof Error ? error.message : 'Failed to create tenant')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleClose = () => {
        setFormData({ name: '', slug: '' })
        setErrors({ name: '', slug: '' })
        setSlugManuallyEdited(false)
        onOpenChange(false)
    }

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) {
            handleClose()
        } else {
            onOpenChange(newOpen)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create New Tenant</DialogTitle>
                    <DialogDescription>
                        Add a new tenant to the system. The slug will be auto-generated from the name.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">
                            Tenant Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="name"
                            placeholder="e.g., Acme Corporation"
                            value={formData.name}
                            onChange={(e) =>
                                setFormData((prev) => ({ ...prev, name: e.target.value }))
                            }
                            disabled={isSubmitting}
                            autoFocus
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="slug">
                            Slug <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="slug"
                            placeholder="e.g., acme-corporation"
                            value={formData.slug}
                            onChange={(e) => {
                                setFormData((prev) => ({ ...prev, slug: e.target.value }))
                                setSlugManuallyEdited(true)
                            }}
                            disabled={isSubmitting}
                        />
                        <p className="text-xs text-muted-foreground">
                            Auto-generated from name. You can override it manually.
                        </p>
                        {errors.slug && (
                            <p className="text-sm text-destructive">{errors.slug}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Creating...' : 'Create Tenant'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
