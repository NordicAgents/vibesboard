'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import toast from 'react-hot-toast'

interface FeatureFlag {
  id: string
  name: string
  description: string | null
  default_value: boolean
}

interface EditFeatureFlagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  flag: FeatureFlag | null
  onSuccess?: () => void
}

export function EditFeatureFlagDialog({
  open,
  onOpenChange,
  flag,
  onSuccess
}: EditFeatureFlagDialogProps) {
  const [description, setDescription] = useState('')
  const [defaultValue, setDefaultValue] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (flag) {
      setDescription(flag.description || '')
      setDefaultValue(flag.default_value)
    }
  }, [flag])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!flag) return

    setIsLoading(true)

    try {
      const response = await fetch(`/api/admin/feature-flags/${flag.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description || null,
          default_value: defaultValue
        })
      })

      const data = await response.json()

      if (response.ok) {
        toast.success('Feature flag updated successfully')
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(data.error || 'Failed to update feature flag')
      }
    } catch (error) {
      console.error('Error updating feature flag:', error)
      toast.error('Failed to update feature flag')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Feature Flag</DialogTitle>
            <DialogDescription>
              Update the description and default value for this flag
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={flag?.name || ''}
                disabled
                readOnly
                className="font-mono opacity-60"
              />
              <p className="text-xs text-muted-foreground">
                Flag names cannot be changed after creation
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                placeholder="Describe what this flag enables..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                disabled={isLoading}
                rows={3}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="edit-default-value" className="text-base">
                  Default Value
                </Label>
                <p className="text-sm text-muted-foreground">
                  Enable this feature by default for new tenants
                </p>
              </div>
              <Switch
                id="edit-default-value"
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
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
