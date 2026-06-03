'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  validateTenantSlug,
  validateTenantName,
  generateSlug
} from '@/lib/validations'
import toast from 'react-hot-toast'

interface CreatedWorkspace {
  id: string
  name: string
  slug: string
}

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (tenant: CreatedWorkspace) => void
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onSuccess
}: CreateWorkspaceDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [slugManuallyEdited, setSlugManuallyEdited] = React.useState(false)
  const [formData, setFormData] = React.useState({ name: '', slug: '' })
  const [errors, setErrors] = React.useState({ name: '', slug: '' })

  // Auto-generate slug from name until the user edits it manually.
  React.useEffect(() => {
    if (!slugManuallyEdited && formData.name) {
      setFormData(prev => ({ ...prev, slug: generateSlug(formData.name) }))
    }
  }, [formData.name, slugManuallyEdited])

  const validate = () => {
    const newErrors = { name: '', slug: '' }
    let isValid = true

    if (!formData.name || !validateTenantName(formData.name)) {
      newErrors.name =
        'Use 2-100 characters: letters, numbers, spaces, hyphens, or underscores'
      isValid = false
    }

    if (!formData.slug || !validateTenantSlug(formData.slug)) {
      newErrors.slug =
        'Slug must be lowercase letters, numbers, and hyphens only'
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

      const response = await fetch('/api/tenants/create-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 409) {
          setErrors(prev => ({ ...prev, slug: 'That URL is already taken' }))
          return
        }
        throw new Error(data.error || 'Failed to create workspace')
      }

      const data = await response.json()
      toast.success('Workspace created')
      handleClose()
      onSuccess?.(data.tenant)
    } catch (error) {
      console.error('Error creating workspace:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to create workspace'
      )
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
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Create a new team workspace. You&apos;ll become its admin and can
            invite others later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">
              Workspace name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workspace-name"
              placeholder="e.g., Acme Team"
              value={formData.name}
              onChange={e =>
                setFormData(prev => ({ ...prev, name: e.target.value }))
              }
              disabled={isSubmitting}
              autoFocus
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-slug">
              Slug <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workspace-slug"
              placeholder="e.g., acme-team"
              value={formData.slug}
              onChange={e => {
                setFormData(prev => ({ ...prev, slug: e.target.value }))
                setSlugManuallyEdited(true)
              }}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Auto-generated from the name. You can override it manually.
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
              {isSubmitting ? 'Creating...' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
