'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'
import type { PlanDefinition } from '@/lib/plans'

interface PlanCardProps {
  plan: PlanDefinition
  currentPlanId?: string
  onSelect?: (planId: string) => void
  loading?: boolean
  className?: string
}

const PLAN_FEATURES: Record<string, string[]> = {
  free: [
    'Unlimited agents',
    '100 messages/month',
    'Agent links',
    'Basic chat interface',
  ],
  pro: [
    'Unlimited agents',
    '5,000 messages/month',
    'Embed widget',
    'Agent notifications',
    'Google Review integration',
    'Inbox (base)',
    '$0.005/msg overage',
  ],
  team: [
    'Unlimited agents',
    '10,000 messages/seat/month',
    'Everything in Pro',
    'Team collaboration',
    'WhatsApp Inbox',
    'Instagram Inbox',
    'Chatwoot integration',
    'Custom branding',
    '$0.003/msg overage',
  ],
  enterprise: [
    'Everything in Team',
    'Custom message limits',
    'SSO / SAML',
    'SLA with guaranteed uptime',
    'Dedicated support',
    'Priority model access',
  ],
}

function formatPrice(plan: PlanDefinition): string {
  if (plan.id === 'free') return '$0'
  if (plan.id === 'enterprise') return 'Custom'
  if (plan.pricePerSeat) return `$${(plan.pricePerSeat / 100).toFixed(0)}`
  return `$${(plan.price / 100).toFixed(0)}`
}

function formatPriceSuffix(plan: PlanDefinition): string {
  if (plan.id === 'free') return '/month'
  if (plan.id === 'enterprise') return ''
  if (plan.pricePerSeat) return '/seat/month'
  return '/month'
}

export function PlanCard({
  plan,
  currentPlanId,
  onSelect,
  loading,
  className,
}: PlanCardProps) {
  const isCurrent = currentPlanId === plan.id
  const isUpgrade =
    !isCurrent &&
    plan.id !== 'free' &&
    plan.id !== 'enterprise'
  const features = PLAN_FEATURES[plan.id] ?? []

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border p-6 transition-all',
        isCurrent
          ? 'border-accent-orange bg-[#fdf8f5] dark:bg-[#2a2420]'
          : 'border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425]',
        className
      )}
    >
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-lg font-semibold text-[#222f30] dark:text-[#f5f8f7]">
            {plan.name}
          </h3>
          {isCurrent && (
            <Badge variant="default" className="text-[10px]">
              Current
            </Badge>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="font-serif text-3xl font-bold text-[#222f30] dark:text-[#f5f8f7]">
            {formatPrice(plan)}
          </span>
          <span className="text-sm text-[#6f7f80]">
            {formatPriceSuffix(plan)}
          </span>
        </div>
        {plan.minSeats && (
          <p className="mt-1 text-xs text-[#6f7f80]">
            Minimum {plan.minSeats} seats
          </p>
        )}
      </div>

      {/* Features */}
      <ul className="mb-6 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-accent-orange" />
            <span className="text-sm text-[#445e5f] dark:text-[#9d9790]">
              {feature}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {plan.id === 'enterprise' ? (
        <Button variant="secondary" className="w-full" disabled>
          Contact Sales
        </Button>
      ) : isCurrent ? (
        <Button variant="secondary" className="w-full" disabled>
          Current Plan
        </Button>
      ) : isUpgrade && onSelect ? (
        <Button
          className="w-full"
          onClick={() => onSelect(plan.id)}
          disabled={loading}
        >
          {loading ? 'Processing...' : `Upgrade to ${plan.name}`}
        </Button>
      ) : (
        <Button variant="secondary" className="w-full" disabled>
          {plan.id === 'free' ? 'Free Plan' : plan.name}
        </Button>
      )}
    </div>
  )
}
