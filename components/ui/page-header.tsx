import * as React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  children,
  className
}: PageHeaderProps) {
  return (
    <div className={cn('animate-fade-slide-in pb-6', className)}>
      {breadcrumbs && (
        <div className="mb-2 flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {breadcrumbs}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <h1 className="font-sans text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {(actions || children) && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
