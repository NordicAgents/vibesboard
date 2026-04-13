'use client'

import { cn } from '@/lib/utils'

const SOURCE_LABELS: Record<string, string> = {
  chat: 'In-App Chat',
  ask_ai: 'Ask AI',
  public_chat: 'Public Link',
  hook_chat: 'Webhook Chat',
  hook_stream: 'Webhook Stream',
  hook_async: 'Webhook Async',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  embed: 'Embed Widget'
}

interface UsageBreakdownProps {
  data: Record<string, number>
  /** Custom label mapping — falls back to SOURCE_LABELS, then the raw key */
  labels?: Record<string, string>
  className?: string
}

export function UsageBreakdown({
  data,
  labels,
  className
}: UsageBreakdownProps) {
  const entries = Object.entries(data)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)

  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  if (entries.length === 0) {
    return <p className="text-sm text-[#6f7f80]">No usage data yet.</p>
  }

  return (
    <div className={cn('space-y-3', className)}>
      {entries.map(([key, count]) => {
        const label = labels?.[key] ?? SOURCE_LABELS[key] ?? key
        const pct = total > 0 ? (count / total) * 100 : 0

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[#222f30] dark:text-[#f5f8f7]">
                {label}
              </span>
              <span className="text-xs tabular-nums text-[#6f7f80]">
                {count.toLocaleString()} ({pct.toFixed(0)}%)
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e4e3e3] dark:bg-[#344348]">
              <div
                className="h-full rounded-full bg-accent-orange transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
