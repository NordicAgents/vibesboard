'use client'

import * as React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ExternalLink, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

interface PlanOption {
  id: string
  name: string
  includedMessages: number
  includedMessagesPerSeat?: number | null
  overageRate: number
}

interface SubscriptionData {
  planId: string
  seatCount: number
  messageCount: number
  messageLimit: number
  overageCount: number
  customMessageLimit?: number | null
  customOverageRate?: number | null
  billingCycleStart: string
  billingCycleEnd: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

interface RollupData {
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  bySource: Record<string, number>
  byAgent: Record<string, number>
  byModel: Record<string, number>
}

interface TenantSubscriptionTabProps {
  tenantId: string
}

export function TenantSubscriptionTab({ tenantId }: TenantSubscriptionTabProps) {
  const [isLoading, setIsLoading] = React.useState(true)
  const [isEditing, setIsEditing] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isSyncing, setIsSyncing] = React.useState(false)

  const [subscription, setSubscription] = React.useState<SubscriptionData | null>(null)
  const [rollup, setRollup] = React.useState<RollupData | null>(null)
  const [billingCycleId, setBillingCycleId] = React.useState('')
  const [plans, setPlans] = React.useState<PlanOption[]>([])

  // Edit form state
  const [formPlanId, setFormPlanId] = React.useState('')
  const [formSeatCount, setFormSeatCount] = React.useState(1)
  const [useCustomLimit, setUseCustomLimit] = React.useState(false)
  const [customLimit, setCustomLimit] = React.useState(0)
  const [useCustomOverage, setUseCustomOverage] = React.useState(false)
  const [customOverage, setCustomOverage] = React.useState(0)
  const [resetUsage, setResetUsage] = React.useState(false)

  const fetchData = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const [subRes, plansRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/subscription`),
        fetch('/api/admin/plans'),
      ])
      if (!subRes.ok) throw new Error('Failed to load subscription')
      if (!plansRes.ok) throw new Error('Failed to load plans')

      const subData = await subRes.json()
      const plansData = await plansRes.json()

      setSubscription(subData.subscription)
      setRollup(subData.rollup)
      setBillingCycleId(subData.billingCycleId)
      setPlans(plansData.plans ?? [])

      // Sync edit form
      if (subData.subscription) {
        const sub = subData.subscription
        setFormPlanId(sub.planId)
        setFormSeatCount(sub.seatCount ?? 1)
        setUseCustomLimit(sub.customMessageLimit != null)
        setCustomLimit(sub.customMessageLimit ?? sub.messageLimit ?? 0)
        setUseCustomOverage(sub.customOverageRate != null)
        setCustomOverage(sub.customOverageRate ?? 0)
      }
    } catch (err) {
      console.error('Error loading subscription:', err)
      toast.error('Failed to load subscription data')
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const body: Record<string, unknown> = {
        planId: formPlanId,
        seatCount: formSeatCount,
      }
      if (useCustomLimit) {
        body.customMessageLimit = customLimit
      } else if (subscription?.customMessageLimit != null) {
        // Clearing the override
        body.customMessageLimit = null
      }
      if (useCustomOverage) {
        body.customOverageRate = customOverage
      } else if (subscription?.customOverageRate != null) {
        body.customOverageRate = null
      }
      if (resetUsage) {
        body.resetUsage = true
      }

      const res = await fetch(`/api/admin/tenants/${tenantId}/subscription`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update subscription')
      }

      const result = await res.json()
      toast.success(
        result.featureFlagsSynced
          ? 'Subscription updated & feature flags synced'
          : 'Subscription updated'
      )
      setIsEditing(false)
      setResetUsage(false)
      fetchData()
    } catch (err: unknown) {
      console.error('Error updating subscription:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setIsSaving(false)
    }
  }

  const handleStripeSync = async () => {
    try {
      setIsSyncing(true)
      const res = await fetch(`/api/admin/tenants/${tenantId}/stripe-sync`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to sync from Stripe')
      }
      toast.success('Subscription synced from Stripe')
      fetchData()
    } catch (err: unknown) {
      console.error('Error syncing from Stripe:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to sync')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleCancel = () => {
    if (subscription) {
      setFormPlanId(subscription.planId)
      setFormSeatCount(subscription.seatCount ?? 1)
      setUseCustomLimit(subscription.customMessageLimit != null)
      setCustomLimit(subscription.customMessageLimit ?? subscription.messageLimit ?? 0)
      setUseCustomOverage(subscription.customOverageRate != null)
      setCustomOverage(subscription.customOverageRate ?? 0)
    }
    setResetUsage(false)
    setIsEditing(false)
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!subscription) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No subscription configured for this tenant.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the migration script or assign a plan manually.
          </p>
        </CardContent>
      </Card>
    )
  }

  const usagePercent = subscription.messageLimit > 0
    ? Math.min(100, (subscription.messageCount / subscription.messageLimit) * 100)
    : 0

  const currentPlan = plans.find(p => p.id === subscription.planId)

  return (
    <div className="space-y-6">
      {/* Usage Overview Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Usage Overview</CardTitle>
              <CardDescription>Billing cycle: {billingCycleId}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={subscription.planId === 'free' ? 'secondary' : 'default'}>
                {currentPlan?.name ?? subscription.planId}
              </Badge>
              {subscription.customMessageLimit != null && (
                <Badge variant="outline" className="text-xs">Custom Limit</Badge>
              )}
              {subscription.customOverageRate != null && (
                <Badge variant="outline" className="text-xs">Custom Overage</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Messages used</span>
              <span className="font-medium">
                {subscription.messageCount.toLocaleString()} / {subscription.messageLimit.toLocaleString()}
              </span>
            </div>
            <Progress value={usagePercent} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{usagePercent.toFixed(1)}% used</span>
              <span>
                {Math.max(0, subscription.messageLimit - subscription.messageCount).toLocaleString()} remaining
              </span>
            </div>
          </div>

          {subscription.overageCount > 0 && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {subscription.overageCount.toLocaleString()} overage messages this cycle
            </div>
          )}

          {/* Rollup breakdown */}
          {rollup && (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total Messages</p>
                  <p className="text-lg font-medium">{rollup.totalMessages.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Input Tokens</p>
                  <p className="text-lg font-medium">{rollup.totalInputTokens.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Output Tokens</p>
                  <p className="text-lg font-medium">{rollup.totalOutputTokens.toLocaleString()}</p>
                </div>
              </div>

              {Object.keys(rollup.bySource).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">By Source</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(rollup.bySource)
                      .sort(([, a], [, b]) => b - a)
                      .map(([source, count]) => (
                        <Badge key={source} variant="outline" className="text-xs">
                          {source}: {count.toLocaleString()}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Subscription Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Subscription Settings</CardTitle>
              <CardDescription>Plan assignment and overrides</CardDescription>
            </div>
            {!isEditing && (
              <Button onClick={() => setIsEditing(true)}>Edit</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isEditing ? (
            <>
              {/* Plan selector */}
              <div className="space-y-2">
                <Label htmlFor="sub-plan">Plan</Label>
                <select
                  id="sub-plan"
                  value={formPlanId}
                  onChange={e => setFormPlanId(e.target.value)}
                  disabled={isSaving}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Seat count */}
              <div className="space-y-2">
                <Label htmlFor="sub-seats">Seat Count</Label>
                <Input
                  id="sub-seats"
                  type="number"
                  min={1}
                  value={formSeatCount}
                  onChange={e => setFormSeatCount(Number(e.target.value))}
                  disabled={isSaving}
                />
              </div>

              <Separator />

              {/* Custom message limit */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Custom Message Limit</Label>
                    <p className="text-xs text-muted-foreground">Override the plan default</p>
                  </div>
                  <Switch
                    checked={useCustomLimit}
                    onCheckedChange={setUseCustomLimit}
                    disabled={isSaving}
                  />
                </div>
                {useCustomLimit && (
                  <Input
                    type="number"
                    min={0}
                    value={customLimit}
                    onChange={e => setCustomLimit(Number(e.target.value))}
                    disabled={isSaving}
                    placeholder="Custom message limit"
                  />
                )}
              </div>

              {/* Custom overage rate */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Custom Overage Rate</Label>
                    <p className="text-xs text-muted-foreground">Override the plan overage rate (cents/msg)</p>
                  </div>
                  <Switch
                    checked={useCustomOverage}
                    onCheckedChange={setUseCustomOverage}
                    disabled={isSaving}
                  />
                </div>
                {useCustomOverage && (
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={customOverage}
                    onChange={e => setCustomOverage(Number(e.target.value))}
                    disabled={isSaving}
                    placeholder="Overage rate in cents"
                  />
                )}
              </div>

              <Separator />

              {/* Reset usage */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>Reset Usage Counters</Label>
                  <p className="text-xs text-muted-foreground">
                    Set messageCount and overageCount to 0
                  </p>
                </div>
                <Switch
                  checked={resetUsage}
                  onCheckedChange={setResetUsage}
                  disabled={isSaving}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="font-medium">{currentPlan?.name ?? subscription.planId}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Seats</p>
                  <p className="font-medium">{subscription.seatCount}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Message Limit</p>
                  <p className="font-medium">
                    {subscription.messageLimit.toLocaleString()}
                    {subscription.customMessageLimit != null && (
                      <Badge variant="outline" className="ml-2 text-xs">custom</Badge>
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Overage Rate</p>
                  <p className="font-medium">
                    {subscription.customOverageRate != null
                      ? `$${subscription.customOverageRate.toFixed(3)}/msg`
                      : currentPlan?.overageRate === 0
                        ? 'Hard cap'
                        : `$${(currentPlan?.overageRate ?? 0).toFixed(3)}/msg`}
                    {subscription.customOverageRate != null && (
                      <Badge variant="outline" className="ml-2 text-xs">custom</Badge>
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Billing Cycle Start</p>
                  <p className="text-sm">{subscription.billingCycleStart || '—'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Billing Cycle End</p>
                  <p className="text-sm">{subscription.billingCycleEnd || '—'}</p>
                </div>
              </div>

              {(subscription.stripeCustomerId || subscription.stripeSubscriptionId) && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">Stripe Integration</p>
                      {subscription.stripeSubscriptionId && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleStripeSync}
                          disabled={isSyncing}
                        >
                          <RefreshCw className={`mr-1.5 size-3 ${isSyncing ? 'animate-spin' : ''}`} />
                          {isSyncing ? 'Syncing...' : 'Sync from Stripe'}
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {subscription.stripeCustomerId && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Stripe Customer</p>
                          <a
                            href={`https://dashboard.stripe.com/customers/${subscription.stripeCustomerId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-sm text-accent-orange hover:underline"
                          >
                            {subscription.stripeCustomerId}
                            <ExternalLink className="size-3" />
                          </a>
                        </div>
                      )}
                      {subscription.stripeSubscriptionId && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Stripe Subscription</p>
                          <a
                            href={`https://dashboard.stripe.com/subscriptions/${subscription.stripeSubscriptionId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-sm text-accent-orange hover:underline"
                          >
                            {subscription.stripeSubscriptionId}
                            <ExternalLink className="size-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
