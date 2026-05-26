import * as React from 'react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@vibesboard/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex animate-fade-slide-in flex-col items-center justify-center px-8 py-16 text-center',
        className
      )}
    >
      {Icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-secondary">
          <Icon className="size-6 text-accent-orange" />
        </div>
      )}
      <h3 className="mb-2 font-sans text-lg font-semibold text-foreground">
        {title}
      </h3>
      {description && (
        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action}
    </div>
  )
}
