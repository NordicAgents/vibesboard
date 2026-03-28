'use client'

import { useState, useEffect } from 'react'
import { CreditCard, Pencil, Users, MessageSquare, Flag } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EditPlanDialog } from '@/components/admin/edit-plan-dialog'
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
  tenantCount: number
  createdAt: string
  updatedAt: string
}

function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}

function formatOverage(rate: number): string {
  if (rate === 0) return 'Hard cap'
  return `$${rate.toFixed(3)}/msg`
}

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingPlan, setEditingPlan] = useState<PlanTemplate | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)

  const fetchPlans = async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/admin/plans')
      if (!res.ok) throw new Error('Failed to load plans')
      const data = await res.json()
      setPlans(data.plans ?? [])
    } catch (err) {
      console.error('Error fetching plans:', err)
      toast.error('Failed to load plans')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchPlans()
  }, [])

  const handleEditSuccess = () => {
    setIsEditOpen(false)
    setEditingPlan(null)
    fetchPlans()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan Templates"
        description="Configure pricing, message limits, and feature access for each plan"
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map(plan => (
            <Card key={plan.id} className="relative">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-[#e6ede6] dark:bg-[#344348]">
                      <CreditCard className="size-5 text-accent-orange" />
                    </div>
                    <CardTitle className="font-sans text-lg font-normal">
                      {plan.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {plan.pricePerSeat
                        ? `${formatPrice(plan.pricePerSeat)}/seat/mo`
                        : `${formatPrice(plan.price)}/mo`}
                      {plan.minSeats ? ` (min ${plan.minSeats} seats)` : ''}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditingPlan(plan)
                      setIsEditOpen(true)
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="size-4 text-[#6f7f80]" />
                  <span className="text-[#445e5f] dark:text-[#6f7f80]">
                    {plan.includedMessagesPerSeat
                      ? `${plan.includedMessagesPerSeat.toLocaleString()}/seat`
                      : plan.includedMessages.toLocaleString()}{' '}
                    messages
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="size-4 text-[#6f7f80]" />
                  <span className="text-[#445e5f] dark:text-[#6f7f80]">
                    Overage: {formatOverage(plan.overageRate)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Flag className="size-4 text-[#6f7f80]" />
                  <span className="text-[#445e5f] dark:text-[#6f7f80]">
                    {plan.featureFlags.length} feature flags
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="size-4 text-[#6f7f80]" />
                  <span className="text-[#445e5f] dark:text-[#6f7f80]">
                    {plan.tenantCount} {plan.tenantCount === 1 ? 'tenant' : 'tenants'}
                  </span>
                </div>

                {plan.featureFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {plan.featureFlags.slice(0, 5).map(flag => (
                      <Badge key={flag} variant="secondary" className="text-xs">
                        {flag}
                      </Badge>
                    ))}
                    {plan.featureFlags.length > 5 && (
                      <Badge variant="outline" className="text-xs">
                        +{plan.featureFlags.length - 5} more
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditPlanDialog
        open={isEditOpen}
        onOpenChange={open => {
          setIsEditOpen(open)
          if (!open) setEditingPlan(null)
        }}
        plan={editingPlan}
        onSuccess={handleEditSuccess}
      />
    </div>
  )
}
