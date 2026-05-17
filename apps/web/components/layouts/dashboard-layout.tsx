'use client'

import { ReactNode } from 'react'
import { cn } from '@vibesboard/utils'

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
        'flex h-full overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]',
        className
      )}
    >
      {/* Left Sidebar */}
      {sidebar && (
        <aside className="hidden w-64 shrink-0 border-r border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] lg:block">
          <div className="h-full overflow-y-auto p-4">{sidebar}</div>
        </aside>
      )}

      {/* Center Content Area */}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>

      {/* Right Panel */}
      {rightPanel && !hideRightPanel && (
        <aside className="hidden w-72 shrink-0 border-l border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] lg:block xl:w-80">
          <div className="h-full overflow-y-auto p-4">{rightPanel}</div>
        </aside>
      )}
    </div>
  )
}
