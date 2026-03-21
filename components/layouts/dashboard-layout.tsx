'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
 children: ReactNode
 sidebar?: ReactNode
 rightPanel?: ReactNode
 className?: string
 hideRightPanel?: boolean
}

export function DashboardLayout({
 children,
 sidebar,
 rightPanel,
 className,
 hideRightPanel = false
}: DashboardLayoutProps) {
 return (
 <div
 className={cn(
 'flex h-full overflow-hidden bg-[#f7f7f5]',
 className
 )}
 >
 {/* Left Sidebar */}
 {sidebar && (
 <aside className="hidden w-64 shrink-0 border-r border-border-warm bg-bg-surface lg:block">
 <div className="h-full p-4">{sidebar}</div>
 </aside>
 )}

 {/* Center Content Area */}
 <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>

 {/* Right Panel */}
 {rightPanel && !hideRightPanel && (
 <aside className="hidden w-72 shrink-0 border-l border-border-warm bg-bg-surface lg:block xl:w-80">
 <div className="h-full overflow-y-auto p-4">{rightPanel}</div>
 </aside>
 )}
 </div>
 )
}
