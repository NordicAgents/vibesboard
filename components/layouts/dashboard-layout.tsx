'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
    children: ReactNode
    sidebar?: ReactNode
    rightPanel?: ReactNode
    className?: string
}

export function DashboardLayout({
    children,
    sidebar,
    rightPanel,
    className
}: DashboardLayoutProps) {
    return (
        <div className={cn('flex min-h-[calc(100vh-4rem)] bg-beige-bg dark:bg-background', className)}>
            {/* Left Sidebar */}
            {sidebar && (
                <aside className="hidden w-64 flex-shrink-0 border-r border-black-10 bg-purewhite-bg dark:border-border dark:bg-card lg:block">
                    <div className="h-full overflow-y-auto p-4">
                        {sidebar}
                    </div>
                </aside>
            )}

            {/* Center Content Area */}
            <main className="flex flex-1 flex-col overflow-hidden">
                {children}
            </main>

            {/* Right Panel */}
            {rightPanel && (
                <aside className="hidden w-80 flex-shrink-0 border-l border-black-10 bg-purewhite-bg dark:border-border dark:bg-card xl:block">
                    <div className="h-full overflow-y-auto p-4">
                        {rightPanel}
                    </div>
                </aside>
            )}
        </div>
    )
}
