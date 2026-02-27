import * as React from 'react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

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
                'animate-fade-slide-in flex flex-col items-center justify-center py-16 px-8 text-center',
                className
            )}
        >
            {Icon && (
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EDE8DE]">
                    <Icon className="h-6 w-6 text-[#D97757]" />
                </div>
            )}
            <h3 className="font-serif text-lg font-normal text-[#1A1915] mb-2">
                {title}
            </h3>
            {description && (
                <p className="mb-6 max-w-sm text-sm text-[#6B6560]">
                    {description}
                </p>
            )}
            {action}
        </div>
    )
}
