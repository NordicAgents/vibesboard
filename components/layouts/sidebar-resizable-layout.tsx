'use client'

import * as React from 'react'

import { useSidebar } from '@/components/sidebar-context'
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
  const { isSidebarOpen, setIsSidebarOpen } = useSidebar()

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

            {/* When OPEN: Show vibesboard text left, Sidebar Toggle right */}
            {isSidebarOpen && (
              <>
                <Link
                  href="/"
                  className="font-switzer text-xl font-bold tracking-tight text-black-primary dark:text-white dark:hover:text-gray-300 ml-2"
                >
                  vibesboard
                </Link>
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
            className={cn(
              'flex-1 overflow-hidden flex flex-col',
              !isSidebarOpen && 'hidden'
            )}
          >
            {isSidebarOpen && (
              <div className="px-3 pb-2">
                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-start h-10 px-4 shadow-none border-black-10 hover:bg-black-5 dark:border-white-10 dark:hover:bg-white-5"
                >
                  <Link href="/agents/create-chat">
                    <IconPlus className="mr-2 h-4 w-4" />
                    <span>New Agent</span>
                  </Link>
                </Button>
              </div>
            )}
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
