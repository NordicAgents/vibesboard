'use client'

import * as React from 'react'
import { PageHeader } from '@/components/ui/page-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UsageProgress } from '@/components/usage-progress'
import { UsageBreakdown } from '@/components/usage-breakdown'
import type {
  TenantSubscription,
  UsageRollupDocument
} from '@vibesboard/contracts'

interface DailyUsage {
  date: string
  count: number
}

interface UsageData {
  subscription: TenantSubscription | null
  rollup: UsageRollupDocument | null
  dailyUsage: DailyUsage[]
  billingCycleId: string
}

export default function TenantUsagePage() {
  const [data, setData] = React.useState<UsageData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function fetchUsage() {
      try {
        // Get active tenant from cookie-based context
        const tenantRes = await fetch('/api/user/active-tenant')
        if (!tenantRes.ok) {
          setError('Could not determine active tenant')
          return
        }
        const { tenant_id: tenantId } = await tenantRes.json()
        if (!tenantId) {
          setError('No active tenant')
          return
        }

        const res = await fetch(`/api/tenants/${tenantId}/usage`)
        if (!res.ok) throw new Error('Failed to load usage data')

        setData(await res.json())
      } catch (err) {
        console.error(err)
        setError('Failed to load usage data')
      } finally {
        setLoading(false)
      }
    }

    fetchUsage()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Usage"
          description="Monitor your message usage this billing cycle"
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#6f7f80]">
            {error ?? 'No usage data available.'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const { subscription, rollup, dailyUsage } = data
  const used = subscription?.messageCount ?? 0
  const limit = subscription?.messageLimit ?? 0
  const planId = subscription?.planId ?? 'free'

  const daysRemaining = subscription?.billingCycleEnd
    ? Math.max(
        0,
        Math.ceil(
          (new Date(subscription.billingCycleEnd).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : null

  const planColors: Record<string, 'default' | 'secondary'> = {
    free: 'secondary',
    pro: 'default',
    team: 'default',
    enterprise: 'default'
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage"
        description="Monitor your message usage this billing cycle"
      />

      {/* Plan & Cycle Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>
                {subscription
                  ? `Billing cycle: ${new Date(subscription.billingCycleStart).toLocaleDateString()} — ${new Date(subscription.billingCycleEnd).toLocaleDateString()}`
                  : 'No plan configured'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {daysRemaining !== null && (
                <span className="text-xs text-[#6f7f80]">
                  {daysRemaining} days remaining
                </span>
              )}
              <Badge
                variant={planColors[planId] ?? 'secondary'}
                className="capitalize"
              >
                {planId}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <UsageProgress used={used} limit={limit} planId={planId} />
          ) : (
            <p className="text-sm text-[#6f7f80]">
              {rollup?.totalMessages.toLocaleString() ?? 0} messages tracked
              this month. This self-hosted build has no billing plan; set
              <code className="mx-1">MONTHLY_MESSAGE_LIMIT</code> to enforce a
              soft workspace cap.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Breakdowns — two columns on larger screens */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Usage by Source */}
        <Card>
          <CardHeader>
            <CardTitle>Usage by Source</CardTitle>
            <CardDescription>
              Where your messages are coming from
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsageBreakdown data={rollup?.bySource ?? {}} />
          </CardContent>
        </Card>

        {/* Usage by Agent */}
        <Card>
          <CardHeader>
            <CardTitle>Usage by Agent</CardTitle>
            <CardDescription>
              Which agents are consuming the most messages
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsageBreakdown data={rollup?.byAgent ?? {}} />
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Usage</CardTitle>
          <CardDescription>
            Messages per day over the last 30 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dailyUsage.length === 0 ? (
            <p className="text-sm text-[#6f7f80]">No usage data yet.</p>
          ) : (
            <div className="space-y-1.5">
              {dailyUsage.map(({ date, count }) => {
                const maxCount = Math.max(...dailyUsage.map(d => d.count))
                const pct = maxCount > 0 ? (count / maxCount) * 100 : 0
                return (
                  <div key={date} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs tabular-nums text-[#6f7f80]">
                      {new Date(date + 'T00:00:00').toLocaleDateString(
                        undefined,
                        {
                          month: 'short',
                          day: 'numeric'
                        }
                      )}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e4e3e3] dark:bg-[#344348]">
                      <div
                        className="h-full rounded-full bg-accent-orange transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-[#6f7f80]">
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
