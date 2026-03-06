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
                'flex animate-fade-slide-in flex-col items-center justify-center px-8 py-16 text-center',
                className
            )}
        >
            {Icon && (
                <div className="mb-4 flex size-14 items-center justify-center rounded-none bg-[#F7F7F5] dark:bg-[#1A1A1A]">
                    <Icon className="size-6 text-accent-orange" />
                </div>
            )}
            <h3 className="mb-2 font-sans text-lg font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
                {title}
            </h3>
            {description && (
                <p className="mb-6 max-w-sm text-sm text-[#5A5A5A] dark:text-[#A0A0A0]">
                    {description}
                </p>
            )}
            {action}
        </div>
    )
}
