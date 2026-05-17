'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DashboardPanelProps {
  children: ReactNode
  title?: string
  action?: ReactNode
  className?: string
}

export function DashboardPanel({
  children,
  title,
  action,
  className
}: DashboardPanelProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && (
            <h2 className="font-switzer text-lg font-bold text-black-primary dark:text-foreground">
              {title}
            </h2>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}

interface DashboardPanelSectionProps {
  children: ReactNode
  title?: string
  description?: string
  className?: string
}

export function DashboardPanelSection({
  children,
  title,
  description,
  className
}: DashboardPanelSectionProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(title || description) && (
        <div>
          {title && (
            <h3 className="font-switzer text-sm font-semibold text-black-primary dark:text-foreground">
              {title}
            </h3>
          )}
          {description && (
            <p className="font-switzer text-xs text-gray-secondary">
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
