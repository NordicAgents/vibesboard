'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DashboardSidebarProps {
    children: ReactNode
    title?: string
    className?: string
}

export function DashboardSidebar({
    children,
    title,
    className
}: DashboardSidebarProps) {
    return (
        <div className={cn('flex flex-col gap-4', className)}>
            {title && (
                <h2 className="font-switzer text-sm font-semibold uppercase tracking-wider text-black-primary dark:text-foreground">
                    {title}
                </h2>
            )}
            <div className="flex flex-col gap-2">
                {children}
            </div>
        </div>
    )
}

interface DashboardSidebarSectionProps {
    children: ReactNode
    title?: string
    action?: ReactNode
    className?: string
}

export function DashboardSidebarSection({
    children,
    title,
    action,
    className
}: DashboardSidebarSectionProps) {
    return (
        <div className={cn('flex flex-col gap-2', className)}>
            {(title || action) && (
                <div className="flex items-center justify-between">
                    {title && (
                        <h3 className="font-switzer text-xs font-medium uppercase tracking-wider text-gray-secondary">
                            {title}
                        </h3>
                    )}
                    {action}
                </div>
            )}
            <div className="flex flex-col gap-1">
                {children}
            </div>
        </div>
    )
}

interface DashboardSidebarItemProps {
    children: ReactNode
    active?: boolean
    onClick?: () => void
    className?: string
}

export function DashboardSidebarItem({
    children,
    active = false,
    onClick,
    className
}: DashboardSidebarItemProps) {
    return (
        <button
            onClick={onClick}
            className={cn(
                'rounded-2xl px-3 py-2 text-left font-switzer text-sm transition-colors',
                active
                    ? 'bg-black-primary text-purewhite-bg'
                    : 'text-black-primary hover:bg-beige-bg/50 dark:text-foreground dark:hover:bg-white/5',
                className
            )}
        >
            {children}
        </button>
    )
}
