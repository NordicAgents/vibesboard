'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { PlanId } from '@/lib/plans'

interface UsageProgressProps {
  used: number
  limit: number
  planId?: PlanId
  /** Compact mode for table cells — no label, smaller height */
  compact?: boolean
  className?: string
}

export function UsageProgress({
  used,
  limit,
  planId,
  compact = false,
  className
}: UsageProgressProps) {
  const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const isOverLimit = used > limit && limit > 0
  const isFree = planId === 'free'

  const barColor = isOverLimit
    ? 'bg-red-500'
    : percentage >= 90
      ? 'bg-red-500'
      : percentage >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e4e3e3] dark:bg-[#344348]">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-[#6f7f80]">
          {used.toLocaleString()}/{limit.toLocaleString()}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
          {used.toLocaleString()} / {limit.toLocaleString()} messages used
        </span>
        <span className="text-xs tabular-nums text-[#6f7f80]">
          {percentage.toFixed(0)}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#e4e3e3] dark:bg-[#344348]">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            barColor
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {isOverLimit && !isFree && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {(used - limit).toLocaleString()} overage messages — these will be
          billed at your plan rate.
        </p>
      )}
      {isFree && percentage >= 90 && !isOverLimit && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Approaching your free plan limit.{' '}
          <Link
            href="/settings/tenant/billing"
            className="underline text-accent-orange hover:text-accent-warm"
          >
            Upgrade for more messages.
          </Link>
        </p>
      )}
      {isFree && isOverLimit && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Free plan limit reached.{' '}
          <Link
            href="/settings/tenant/billing"
            className="underline text-accent-orange hover:text-accent-warm"
          >
            Upgrade to continue using your agents.
          </Link>
        </p>
      )}
    </div>
  )
}
