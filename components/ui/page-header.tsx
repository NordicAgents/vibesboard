import * as React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
    title: string
    description?: string
    breadcrumbs?: React.ReactNode
    actions?: React.ReactNode
    className?: string
}

export function PageHeader({
    title,
    description,
    breadcrumbs,
    actions,
    className
}: PageHeaderProps) {
    return (
        <div className={cn('space-y-4 pb-6', className)}>
            {breadcrumbs && (
                <div className="text-sm text-muted-foreground">
                    {breadcrumbs}
                </div>
            )}
            <div className="flex items-start justify-between">
                <div className="space-y-1">
                    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                    {description && (
                        <p className="text-muted-foreground">{description}</p>
                    )}
                </div>
                {actions && (
                    <div className="flex items-center gap-2">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    )
}
