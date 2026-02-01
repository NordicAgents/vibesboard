'use client'

import * as React from 'react'

import { useLocalStorage } from '@/lib/hooks/use-local-storage'
import { Button } from '@/components/ui/button'
import { IconSidebar, IconPlus } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import Link from 'next/link'
import { UserMenu } from '@/components/user-menu'
import { ThemeToggle } from '@/components/theme-toggle'

interface SidebarResizableLayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
  user?: any // Pass user prop to render UserMenu in the layout if needed
}

export function SidebarResizableLayout({
  children,
  sidebar,
  user
}: SidebarResizableLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useLocalStorage(
    'sidebar-is-open',
    true
  )

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      <aside
        className={cn(
          'hidden flex-col border-r border-black-10 bg-purewhite-bg transition-[width] duration-300 ease-in-out dark:border-border dark:bg-card lg:flex',
          isSidebarOpen ? 'w-[300px]' : 'w-[50px]'
        )}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Header area - changes layout based on state */}
          <div
            className={cn(
              'flex p-2',
              isSidebarOpen
                ? 'items-center justify-between'
                : 'flex-col items-center gap-2'
            )}
          >
            {/* When CLOSED: Show Sidebar Toggle first, then New Agent */}
            {!isSidebarOpen && (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => setIsSidebarOpen(true)}
                      >
                        <IconSidebar className="h-5 w-5" />
                        <span className="sr-only">Open Sidebar</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Open Sidebar</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        asChild
                      >
                        <Link href="/agents/create-chat">
                          <IconPlus className="h-5 w-5" />
                          <span className="sr-only">New Agent</span>
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">New Agent</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}

            {/* When OPEN: Show New Agent left, Sidebar Toggle right */}
            {isSidebarOpen && (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        asChild
                      >
                        <Link href="/agents/create-chat">
                          <IconPlus className="h-5 w-5" />
                          <span className="sr-only">New Agent</span>
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>New Agent</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => setIsSidebarOpen(false)}
                      >
                        <IconSidebar className="h-5 w-5" />
                        <span className="sr-only">Close Sidebar</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Close Sidebar</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>

          {/* Main Sidebar Content - Only visible when open */}
          <div
            className={cn('flex-1 overflow-hidden', !isSidebarOpen && 'hidden')}
          >
            {sidebar}
          </div>
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col overflow-auto bg-beige-bg dark:bg-background">
        {/* Top bar area */}
        <div className="absolute left-0 top-0 z-10 w-full flex items-center justify-end p-2 pointer-events-none">
          {/* Right Controls (Theme, User) - Pointer events auto */}
          <div className="flex items-center gap-2 pointer-events-auto">
            <ThemeToggle />
            {user && <UserMenu user={user} />}
          </div>
        </div>

        {children}
      </div>
    </div>
  )
}
