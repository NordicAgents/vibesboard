'use client'

import * as React from 'react'

import { useSidebar } from '@/components/sidebar-context'
import { Button } from '@/components/ui/button'
import {
  IconSidebar,
  IconPlus,
  IconMenu,
  IconChevronUpDown
} from '@/components/ui/icons'
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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useState } from 'react'

interface SidebarResizableLayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
  user?: any // Pass user prop to render UserMenu in the layout if needed
}

// Helper component to render DashboardLayout.sidebar from children if it exists
// This is a bit of a hack to extract the sidebar from the children tree for mobile view
// In a cleaner implementation, we might pass the secondary sidebar explicitly to this layout
const MobileSecondarySidebar = ({
  children
}: {
  children: React.ReactNode
}) => {
  // Use React.Children.map to find DashboardLayout
  let sidebarContent: React.ReactNode = null

  // This is a simplified check. In a real app, you might need recursive search or context.
  // For now, we assume DashboardLayout is a direct child or close to it.
  React.Children.forEach(children, child => {
    if (React.isValidElement(child)) {
      // @ts-ignore - checking for props.sidebar
      if (child.props && child.props.sidebar) {
        // @ts-ignore
        sidebarContent = child.props.sidebar
      }
    }
  })

  return sidebarContent ? (
    <div className="mt-4 border-t pt-4">{sidebarContent}</div>
  ) : null
}

export function SidebarResizableLayout({
  children,
  sidebar,
  user
}: SidebarResizableLayoutProps) {
  const { isSidebarOpen, setIsSidebarOpen } = useSidebar()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'agents' | 'current-agent'>(
    'agents'
  )

  // Extract secondary sidebar (DashboardSidebar) from children if present
  // This is needed because DashboardLayout hides it on mobile (lg:block)
  // We want to show it in the mobile menu
  let secondarySidebar: React.ReactNode = null
  React.Children.forEach(children, child => {
    if (React.isValidElement(child)) {
      // @ts-ignore
      if (child.props && child.props.sidebar) {
        // @ts-ignore
        secondarySidebar = child.props.sidebar
      }
    }
  })

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
          {/* Right Controls (Theme, User, Menu) - Pointer events auto */}
          <div className="flex items-center gap-2 pointer-events-auto">
            <ThemeToggle />
            {user && <UserMenu user={user} />}

            {/* Mobile Menu Trigger - Visible only on mobile */}
            <div className="lg:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <IconMenu className="h-5 w-5" />
                    <span className="sr-only">Open Menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] p-0">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b p-4">
                      <Link
                        href="/"
                        className="font-switzer text-xl font-bold tracking-tight text-black-primary dark:text-white"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        vibesboard
                      </Link>
                    </div>

                    {/* View Switcher (Only if secondary sidebar exists) */}
                    {secondarySidebar && (
                      <div className="px-3 py-2">
                        <div className="flex rounded-lg bg-muted p-1">
                          <button
                            onClick={() => setMobileView('agents')}
                            className={cn(
                              'flex-1 rounded-md py-1 text-sm font-medium transition-colors',
                              mobileView === 'agents'
                                ? 'bg-background shadow-sm text-foreground'
                                : 'text-muted-foreground hover:bg-background/50'
                            )}
                          >
                            Agents
                          </button>
                          <button
                            onClick={() => setMobileView('current-agent')}
                            className={cn(
                              'flex-1 rounded-md py-1 text-sm font-medium transition-colors',
                              mobileView === 'current-agent'
                                ? 'bg-background shadow-sm text-foreground'
                                : 'text-muted-foreground hover:bg-background/50'
                            )}
                          >
                            Current Agent
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 overflow-hidden flex flex-col">
                      {/* Show Agents List */}
                      {(!secondarySidebar || mobileView === 'agents') && (
                        <>
                          <div className="px-3 py-2">
                            <Button
                              asChild
                              variant="outline"
                              className="w-full justify-start h-10 px-4 shadow-none border-black-10 hover:bg-black-5 dark:border-white-10 dark:hover:bg-white-5"
                            >
                              <Link
                                href="/agents/create-chat"
                                onClick={() => setMobileMenuOpen(false)}
                              >
                                <IconPlus className="mr-2 h-4 w-4" />
                                <span>New Agent</span>
                              </Link>
                            </Button>
                          </div>
                          {sidebar}
                        </>
                      )}

                      {/* Show Current Agent Menu (Secondary Sidebar) */}
                      {secondarySidebar && mobileView === 'current-agent' && (
                        <div className="flex-1 overflow-y-auto px-4 py-3">
                          {secondarySidebar}
                        </div>
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>

        {children}
      </div>
    </div>
  )
}
