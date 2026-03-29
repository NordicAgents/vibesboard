'use client'

import { Badge } from '@/components/ui/badge'
import type { TenantSubscription } from '@/lib/firestore-types'

interface BillingStatusProps {
  subscription: TenantSubscription | null
}

export function BillingStatus({ subscription }: BillingStatusProps) {
  if (!subscription) {
    return (
      <Badge variant="secondary" className="capitalize">
        No Plan
      </Badge>
    )
  }

  return (
    <Badge variant="default" className="capitalize">
      {subscription.planId}
    </Badge>
  )
}
