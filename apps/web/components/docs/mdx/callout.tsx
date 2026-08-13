import type { ReactNode } from 'react'
import { AlertTriangle, Info, Lightbulb, ShieldAlert } from 'lucide-react'

import { cn } from '@vibesboard/utils'

type CalloutType = 'note' | 'tip' | 'warning' | 'danger'

const CALLOUT_STYLES: Record<
  CalloutType,
  { icon: typeof Info; className: string; iconClassName: string }
> = {
  note: {
    icon: Info,
    className: 'border-border-warm bg-bg-surface',
    iconClassName: 'text-text-secondary'
  },
  tip: {
    icon: Lightbulb,
    className: 'border-accent-orange/40 bg-accent-glow',
    iconClassName: 'text-accent-orange'
  },
  warning: {
    icon: AlertTriangle,
    className:
      'border-amber-400/40 bg-amber-400/10 dark:border-amber-300/30 dark:bg-amber-300/10',
    iconClassName: 'text-amber-600 dark:text-amber-300'
  },
  danger: {
    icon: ShieldAlert,
    className:
      'border-destructive/40 bg-destructive/10 dark:border-destructive/30',
    iconClassName: 'text-destructive'
  }
}

export function Callout({
  type = 'note',
  title,
  children
}: {
  type?: CalloutType
  title?: string
  children: ReactNode
}) {
  const { icon: Icon, className, iconClassName } = CALLOUT_STYLES[type]

  return (
    <div
      className={cn(
        'not-prose my-5 flex gap-3 rounded-xl border px-4 py-3.5 text-sm leading-relaxed text-text-secondary',
        className
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconClassName)} />
      <div className="min-w-0 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_p]:my-2">
        {title && <p className="font-medium text-text-primary">{title}</p>}
        {children}
      </div>
    </div>
  )
}
