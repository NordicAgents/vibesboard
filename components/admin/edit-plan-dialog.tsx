'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  FEATURE_FLAG_NAMES,
  FEATURE_FLAG_HIERARCHY,
  getChildFlags,
  getAllDescendants,
  getParentFlag
} from '@/lib/feature-flags'
import type { FeatureFlagName } from '@/lib/feature-flags'
import toast from 'react-hot-toast'

interface PlanTemplate {
  id: string
  name: string
  price: number
  pricePerSeat?: number | null
  minSeats?: number | null
  includedMessages: number
  includedMessagesPerSeat?: number | null
  overageRate: number
  featureFlags: string[]
}

interface EditPlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanTemplate | null
  onSuccess: () => void
}

/** Group flags recursively: parents first, then children, then grandchildren */
function getGroupedFlags(): {
  name: FeatureFlagName
  depth: number
  parent?: FeatureFlagName
}[] {
  const result: {
    name: FeatureFlagName
    depth: number
    parent?: FeatureFlagName
  }[] = []
  const children = new Set(
    Object.keys(FEATURE_FLAG_HIERARCHY) as FeatureFlagName[]
  )

  function addFlagAndChildren(flag: FeatureFlagName, depth: number) {
    const parent = FEATURE_FLAG_HIERARCHY[flag]
    result.push({ name: flag, depth, parent })
    const flagChildren = getChildFlags(flag)
    for (const child of flagChildren) {
      addFlagAndChildren(child, depth + 1)
    }
  }

  for (const flag of FEATURE_FLAG_NAMES) {
    if (!children.has(flag)) {
      addFlagAndChildren(flag, 0)
    }
  }

  return result
}

const groupedFlags = getGroupedFlags()

export function EditPlanDialog({
  open,
  onOpenChange,
  plan,
  onSuccess
}: EditPlanDialogProps) {
  const [isSaving, setIsSaving] = React.useState(false)
  const [migrationPrompt, setMigrationPrompt] = React.useState<{
    planId: string
    subscribersToMigrate: number
  } | null>(null)
  const [isMigrating, setIsMigrating] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '',
    price: 0,
    pricePerSeat: null as number | null,
    minSeats: null as number | null,
    includedMessages: 0,
    includedMessagesPerSeat: null as number | null,
    overageRate: 0,
    featureFlags: [] as string[]
  })

  // Reset form when plan changes
  React.useEffect(() => {
    if (plan) {
      setForm({
        name: plan.name,
        price: plan.price,
        pricePerSeat: plan.pricePerSeat ?? null,
        minSeats: plan.minSeats ?? null,
        includedMessages: plan.includedMessages,
        includedMessagesPerSeat: plan.includedMessagesPerSeat ?? null,
        overageRate: plan.overageRate,
        featureFlags: [...plan.featureFlags]
      })
    }
  }, [plan])

  const toggleFlag = (flagName: string, enabled: boolean) => {
    setForm(prev => {
      let flags = [...prev.featureFlags]
      if (enabled) {
        if (!flags.includes(flagName)) flags.push(flagName)
        // Enable all ancestors up the chain
        let current: FeatureFlagName | null = getParentFlag(
          flagName as FeatureFlagName
        )
        while (current) {
          if (!flags.includes(current)) flags.push(current)
          current = getParentFlag(current)
        }
      } else {
        flags = flags.filter(f => f !== flagName)
        // Disable all descendants recursively
        const descendants = getAllDescendants(flagName as FeatureFlagName)
        flags = flags.filter(f => !descendants.includes(f as FeatureFlagName))
      }
      return { ...prev, featureFlags: flags }
    })
  }

  const handleSave = async () => {
    if (!plan) return
    try {
      setIsSaving(true)
      const res = await fetch(`/api/admin/plans/${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update plan')
      }
      const data = await res.json()
      const p = data.propagation
      if (p && (p.featureFlagsSynced || p.messageLimitsUpdated)) {
        const parts: string[] = []
        if (p.featureFlagsSynced) parts.push('feature flags synced')
        if (p.messageLimitsUpdated) parts.push('message limits updated')
        toast.success(
          `${form.name} plan updated. ${p.tenantsAffected} tenant${p.tenantsAffected === 1 ? '' : 's'}: ${parts.join(', ')}.`
        )
        if (p.errors.length > 0) {
          toast.error(
            `${p.errors.length} tenant${p.errors.length === 1 ? '' : 's'} failed to sync`
          )
        }
      } else {
        toast.success(`${form.name} plan updated`)
      }

      // If price was rotated, prompt for migration
      if (p?.priceRotated && p.pendingMigration) {
        setMigrationPrompt({
          planId: plan.id,
          subscribersToMigrate: p.pendingMigration.subscribersToMigrate
        })
        return // Don't close dialog yet
      }

      onSuccess()
    } catch (err: unknown) {
      console.error('Error updating plan:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to update plan')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMigrate = async () => {
    if (!migrationPrompt) return
    try {
      setIsMigrating(true)
      const res = await fetch(
        `/api/admin/plans/${migrationPrompt.planId}/migrate-prices`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Migration failed')
      }
      const data = await res.json()
      toast.success(
        `Migrated ${data.migrated} subscriber${data.migrated === 1 ? '' : 's'} with proration`
      )
      if (data.errors?.length > 0) {
        toast.error(
          `${data.errors.length} subscription${data.errors.length === 1 ? '' : 's'} failed to migrate`
        )
      }
    } catch (err: unknown) {
      console.error('Error migrating prices:', err)
      toast.error(err instanceof Error ? err.message : 'Migration failed')
    } finally {
      setIsMigrating(false)
      setMigrationPrompt(null)
      onSuccess()
    }
  }

  const handleSkipMigration = () => {
    toast(
      'New price active for new subscribers. Existing subscribers stay on old price.',
      { icon: 'ℹ️' }
    )
    setMigrationPrompt(null)
    onSuccess()
  }

  if (!plan) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {plan.name} Plan</DialogTitle>
          <DialogDescription>
            Update plan configuration. Changes propagate to all existing tenants
            on this plan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan-name">Plan Name</Label>
              <Input
                id="plan-name"
                value={form.name}
                onChange={e =>
                  setForm(prev => ({ ...prev, name: e.target.value }))
                }
                disabled={isSaving}
              />
            </div>
          </div>

          <Separator />

          {/* Pricing */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Base Price (cents)</Label>
                <Input
                  id="price"
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      price: Number(e.target.value)
                    }))
                  }
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  {form.price === 0
                    ? 'Free'
                    : `$${(form.price / 100).toFixed(2)}/mo`}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pricePerSeat">Price Per Seat (cents)</Label>
                <Input
                  id="pricePerSeat"
                  type="number"
                  min={0}
                  value={form.pricePerSeat ?? ''}
                  placeholder="Not set"
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      pricePerSeat:
                        e.target.value === '' ? null : Number(e.target.value)
                    }))
                  }
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  {form.pricePerSeat
                    ? `$${(form.pricePerSeat / 100).toFixed(2)}/seat`
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="minSeats">Minimum Seats</Label>
              <Input
                id="minSeats"
                type="number"
                min={1}
                value={form.minSeats ?? ''}
                placeholder="Not set"
                onChange={e =>
                  setForm(prev => ({
                    ...prev,
                    minSeats:
                      e.target.value === '' ? null : Number(e.target.value)
                  }))
                }
                disabled={isSaving}
              />
            </div>
          </div>

          <Separator />

          {/* Message Limits */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Message Limits</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="includedMessages">Included Messages</Label>
                <Input
                  id="includedMessages"
                  type="number"
                  min={0}
                  value={form.includedMessages}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      includedMessages: Number(e.target.value)
                    }))
                  }
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="includedMessagesPerSeat">
                  Messages Per Seat
                </Label>
                <Input
                  id="includedMessagesPerSeat"
                  type="number"
                  min={0}
                  value={form.includedMessagesPerSeat ?? ''}
                  placeholder="Not set"
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      includedMessagesPerSeat:
                        e.target.value === '' ? null : Number(e.target.value)
                    }))
                  }
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="overageRate">Overage Rate (cents/message)</Label>
              <Input
                id="overageRate"
                type="number"
                min={0}
                step={0.01}
                value={form.overageRate}
                onChange={e =>
                  setForm(prev => ({
                    ...prev,
                    overageRate: Number(e.target.value)
                  }))
                }
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                {form.overageRate === 0
                  ? 'Hard cap — no messages beyond limit'
                  : `$${form.overageRate.toFixed(3)} per message over limit`}
              </p>
            </div>
          </div>

          <Separator />

          {/* Feature Flags */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Feature Flags</h3>
              <span className="text-xs text-muted-foreground">
                {form.featureFlags.length} enabled
              </span>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              {groupedFlags.map(({ name, depth }) => {
                const isEnabled = form.featureFlags.includes(name)
                const parent = FEATURE_FLAG_HIERARCHY[name]
                const parentDisabled =
                  depth > 0 && parent && !form.featureFlags.includes(parent)
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-md px-2 py-1.5"
                    style={
                      depth > 0
                        ? { marginLeft: `${depth * 1.5}rem` }
                        : undefined
                    }
                  >
                    <label
                      htmlFor={`flag-${name}`}
                      className={`cursor-pointer text-sm ${
                        parentDisabled ? 'text-muted-foreground' : ''
                      }`}
                    >
                      {depth > 0 && (
                        <span className="mr-1 text-muted-foreground">└</span>
                      )}
                      {name}
                    </label>
                    <Switch
                      id={`flag-${name}`}
                      checked={isEnabled}
                      onCheckedChange={checked => toggleFlag(name, checked)}
                      disabled={isSaving || !!parentDisabled}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Actions */}
        {migrationPrompt ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Price updated in Stripe. Migrate{' '}
              {migrationPrompt.subscribersToMigrate} existing subscriber
              {migrationPrompt.subscribersToMigrate === 1 ? '' : 's'} to the new
              price?
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              This will prorate their current billing period.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSkipMigration}
                disabled={isMigrating}
              >
                Skip
              </Button>
              <Button size="sm" onClick={handleMigrate} disabled={isMigrating}>
                {isMigrating ? 'Migrating...' : 'Migrate Now'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
