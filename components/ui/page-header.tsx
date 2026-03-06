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
                <div className="mb-2 flex items-center gap-1 text-xs text-[#8A8A8A]">
                    {breadcrumbs}
                </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="space-y-1">
                    <h1 className="font-sans text-2xl font-medium leading-tight tracking-tight text-[#1A1A1A] sm:text-3xl">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-1 text-sm text-[#5A5A5A]">{description}</p>
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
