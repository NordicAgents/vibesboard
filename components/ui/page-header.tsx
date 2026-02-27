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
                <div className="mb-2 flex items-center gap-1 text-xs text-[#9D9790]">
                    {breadcrumbs}
                </div>
            )}
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="font-serif text-3xl font-normal leading-tight text-[#1A1915]">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-1 text-sm text-[#6B6560]">{description}</p>
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
