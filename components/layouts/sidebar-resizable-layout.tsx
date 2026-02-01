'use client'

import * as React from 'react'

import { useLocalStorage } from '@/lib/hooks/use-local-storage'
import { Button } from '@/components/ui/button'
import { IconSidebar } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'

interface SidebarResizableLayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
}

export function SidebarResizableLayout({
  children,
  sidebar
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
          isSidebarOpen ? 'w-[300px]' : 'w-0 border-r-0'
        )}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex justify-end p-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    <IconSidebar className="h-4 w-4" />
                    <span className="sr-only">Close Sidebar</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close Sidebar</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex-1 overflow-hidden">{sidebar}</div>
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col overflow-auto bg-beige-bg dark:bg-background">
        <div
          className={cn(
            'absolute left-4 top-4 z-10 hidden lg:block',
            isSidebarOpen && 'hidden'
          )}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 bg-background/50 backdrop-blur-sm hover:bg-background/80"
                  onClick={() => setIsSidebarOpen(true)}
                >
                  <IconSidebar className="h-4 w-4" />
                  <span className="sr-only">Open Sidebar</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open Sidebar</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {children}
      </div>
    </div>
  )
}
