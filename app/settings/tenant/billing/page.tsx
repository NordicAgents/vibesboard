'use client'

import * as React from 'react'
import { PageHeader } from '@/components/ui/page-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PlanCard } from '@/components/plan-card'
import { BillingStatus } from '@/components/billing-status'
import { UsageProgress } from '@/components/usage-progress'
import { CreditCard, ExternalLink, FileText, Loader2 } from 'lucide-react'
import type { TenantSubscription } from '@/lib/firestore-types'
import type { PlanDefinition, PlanId } from '@/lib/plans'

interface BillingData {
  subscription: TenantSubscription | null
  plan: PlanDefinition | null
  allPlans: PlanDefinition[]
  hasPaymentMethod: boolean
  invoices: Array<{
    id: string
    date: string
    amount: number
    status: string
    pdfUrl: string | null
  }>
}

export default function BillingPage() {
  const [data, setData] = React.useState<BillingData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [upgrading, setUpgrading] = React.useState<string | null>(null)
  const [portalLoading, setPortalLoading] = React.useState(false)
  const [tenantId, setTenantId] = React.useState<string | null>(null)

  // Check for success/cancel in URL
  const searchParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null
  const checkoutSuccess = searchParams?.get('success') === 'true'
  const checkoutCanceled = searchParams?.get('canceled') === 'true'

  const fetchBilling = React.useCallback(async () => {
    try {
      // Get active tenant
      const tenantRes = await fetch('/api/user/active-tenant')
      if (!tenantRes.ok) {
        setError('Could not determine active tenant')
        return
      }
      const { tenant_id: tid } = await tenantRes.json()
      if (!tid) {
        setError('No active tenant')
        return
      }
      setTenantId(tid)

      const res = await fetch(`/api/tenants/${tid}/billing`)
      if (!res.ok) throw new Error('Failed to load billing data')
      setData(await res.json())
    } catch (err) {
      console.error(err)
      setError('Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchBilling()
  }, [fetchBilling])

  // Poll for subscription update after successful checkout
  React.useEffect(() => {
    if (!checkoutSuccess || !tenantId) return

    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      if (attempts > 10) {
        clearInterval(interval)
        return
      }

      try {
        const res = await fetch(`/api/tenants/${tenantId}/billing`)
        if (res.ok) {
          const newData = await res.json()
          if (newData.subscription?.stripeSubscriptionId) {
            setData(newData)
            clearInterval(interval)
            // Clean up URL params
            window.history.replaceState(
              {},
              '',
              '/settings/tenant/billing'
            )
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [checkoutSuccess, tenantId])

  async function handleUpgrade(planId: string) {
    if (!tenantId) return
    setUpgrading(planId)

    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          planId,
          seatCount: planId === 'team' ? 3 : undefined,
        }),
      })

      const result = await res.json()
      if (result.url) {
        window.location.href = result.url
      } else {
        setError(result.error ?? 'Failed to create checkout session')
      }
    } catch (err) {
      console.error(err)
      setError('Failed to start upgrade')
    } finally {
      setUpgrading(null)
    }
  }

  async function handlePortal() {
    if (!tenantId) return
    setPortalLoading(true)

    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })

      const result = await res.json()
      if (result.url) {
        window.location.href = result.url
      } else {
        setError(result.error ?? 'Failed to open billing portal')
      }
    } catch (err) {
      console.error(err)
      setError('Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Billing"
          description="Manage your subscription and payment"
        />
        <Card>
          <CardContent className="py-8 text-center text-sm text-[#6f7f80]">
            {error}
          </CardContent>
        </Card>
      </div>
    )
  }

  const subscription = data?.subscription ?? null
  const allPlans = data?.allPlans ?? []
  const invoices = data?.invoices ?? []
  const planId = (subscription?.planId ?? 'free') as PlanId
  const hasStripeSubscription = Boolean(subscription?.stripeSubscriptionId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Manage your subscription and payment"
      />

      {/* Success / Cancel banners */}
      {checkoutSuccess && (
        <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="py-4 text-center text-sm text-emerald-700 dark:text-emerald-300">
            {subscription?.stripeSubscriptionId
              ? 'Your subscription is now active!'
              : (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Processing your payment...
                </span>
              )}
          </CardContent>
        </Card>
      )}
      {checkoutCanceled && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
            Checkout was canceled. No charges were made.
          </CardContent>
        </Card>
      )}

      {/* Current Plan */}
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
            <BillingStatus subscription={subscription} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {subscription && (
            <UsageProgress
              used={subscription.messageCount ?? 0}
              limit={subscription.messageLimit ?? 0}
              planId={planId}
            />
          )}
          {hasStripeSubscription && (
            <Button
              variant="secondary"
              onClick={handlePortal}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <CreditCard className="mr-2 size-4" />
              )}
              Manage Subscription
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      <div>
        <h2 className="mb-4 font-serif text-xl font-semibold text-[#222f30] dark:text-[#f5f8f7]">
          Plans
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allPlans
            .filter((p) => p.id !== 'enterprise')
            .map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                currentPlanId={planId}
                onSelect={handleUpgrade}
                loading={upgrading === plan.id}
              />
            ))}
        </div>
      </div>

      {/* Payment Method */}
      {hasStripeSubscription && (
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>
              {data?.hasPaymentMethod
                ? 'You have a payment method on file.'
                : 'No payment method on file.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={handlePortal}>
              <CreditCard className="mr-2 size-4" />
              {data?.hasPaymentMethod
                ? 'Update Payment Method'
                : 'Add Payment Method'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>
              Your last {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-[#e4e3e3] p-3 dark:border-[#344348]"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="size-4 text-[#6f7f80]" />
                    <div>
                      <p className="text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
                        ${(inv.amount / 100).toFixed(2)}
                      </p>
                      <p className="text-xs text-[#6f7f80]">
                        {new Date(inv.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={inv.status === 'paid' ? 'default' : 'secondary'}
                      className="capitalize"
                    >
                      {inv.status}
                    </Badge>
                    {inv.pdfUrl && (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#6f7f80] hover:text-[#222f30] dark:hover:text-[#f5f8f7]"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
