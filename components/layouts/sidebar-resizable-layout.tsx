'use client'

import * as React from 'react'

import { useSidebar } from '@/components/sidebar-context'
import { SecondarySidebarSetterProvider } from '@/components/layouts/secondary-sidebar-context'
import { Button } from '@/components/ui/button'
import { IconSidebar, IconPlus, IconMenu } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserMenu } from '@/components/user-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { useEffect } from 'react'

interface SidebarResizableLayoutProps {
  children: React.ReactNode
  sidebar: React.ReactNode
  user?: any // Pass user prop to render UserMenu in the layout if needed
  isSuperAdmin?: boolean
  canManageTenant?: boolean
}

export function SidebarResizableLayout({
  children,
  sidebar,
  user,
  isSuperAdmin,
  canManageTenant
}: SidebarResizableLayoutProps) {
  const { isSidebarOpen, setIsSidebarOpen } = useSidebar()
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [mobileView, setMobileView] = React.useState<
    'agents' | 'current-agent'
  >(
    'agents'
  )
  const [secondarySidebar, setSecondarySidebar] =
    React.useState<React.ReactNode | null>(null)

  // Route-aware auto-collapse for agent creator page
  const pathname = usePathname()
  const prevPathnameRef = React.useRef(pathname)
  const isSidebarOpenRef = React.useRef(isSidebarOpen)
  const autoCollapseStateRef = React.useRef<{
    shouldRestore: boolean
    manuallyChanged: boolean
  } | null>(null)

  // Keep ref in sync with current state
  isSidebarOpenRef.current = isSidebarOpen

  // Auto-collapse sidebar when entering create page, restore when leaving
  useEffect(() => {
    const wasCreatePage = prevPathnameRef.current === '/agents/create-chat'
    const isNowCreatePage = pathname === '/agents/create-chat'
    const isCompactViewport =
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1024px)').matches

    const isAgentDetailPage =
      pathname.startsWith('/agents/') &&
      pathname !== '/agents/create-chat' &&
      pathname !== '/agents/new'

    if (!wasCreatePage && isNowCreatePage) {
      // Entering create page - auto-collapse if sidebar is open
      if (isSidebarOpenRef.current) {
        autoCollapseStateRef.current = {
          shouldRestore: true,
          manuallyChanged: false
        }
        setIsSidebarOpen(false)
      }
    } else if (wasCreatePage && !isNowCreatePage) {
      // Leaving create page - restore if user didn't manually toggle
      if (
        autoCollapseStateRef.current?.shouldRestore &&
        !autoCollapseStateRef.current?.manuallyChanged
      ) {
        if (!isCompactViewport) {
          setIsSidebarOpen(true)
        }
      }
      autoCollapseStateRef.current = null
    }

    // Auto-collapse primary sidebar on smaller viewports in agent pages
    if (isAgentDetailPage && isCompactViewport && isSidebarOpenRef.current) {
      setIsSidebarOpen(false)
    }

    prevPathnameRef.current = pathname
  }, [pathname, setIsSidebarOpen])

  // Manual toggle handler that tracks user interactions
  const handleManualToggle = (open: boolean) => {
    if (autoCollapseStateRef.current) {
      autoCollapseStateRef.current.manuallyChanged = true
    }
    setIsSidebarOpen(open)
  }

  // Prefer showing the "Current Agent" view when available
  useEffect(() => {
    if (!secondarySidebar) {
      setMobileView('agents')
      return
    }

    const isAgentDetailPage =
      pathname.startsWith('/agents/') &&
      pathname !== '/agents/create-chat' &&
      pathname !== '/agents/new'

    if (isAgentDetailPage) {
      setMobileView(prev => (prev === 'agents' ? 'current-agent' : prev))
    }
  }, [pathname, secondarySidebar])

  const handlePrimarySidebarNavigate = React.useCallback(
    (e: React.MouseEvent) => {
      if (typeof window === 'undefined') return

      const target = e.target as HTMLElement | null
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link) return

      const href = link.getAttribute('href') ?? ''
      if (!href.startsWith('/agents/')) return

      if (window.matchMedia('(max-width: 1024px)').matches && isSidebarOpen) {
        setIsSidebarOpen(false)
      }
    },
    [isSidebarOpen, setIsSidebarOpen]
  )

  const handleMobileAgentsNavigate = React.useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null
      const link = target?.closest?.('a[href]')
      if (!link) return
      setMobileMenuOpen(false)
    },
    []
  )

  const handleMobileCurrentAgentAction = React.useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null
      const shouldClose = target?.closest?.(
        'a[href], [data-mobile-menu-close="true"]'
      )
      if (!shouldClose) return
      setMobileMenuOpen(false)
    },
    []
  )

  return (
    <SecondarySidebarSetterProvider setSecondarySidebar={setSecondarySidebar}>
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
                        onClick={() => handleManualToggle(true)}
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
                        onClick={() => handleManualToggle(false)}
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
            <div onClick={handlePrimarySidebarNavigate}>{sidebar}</div>
          </div>
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col overflow-auto bg-beige-bg dark:bg-background">
        {/* Top bar area */}
        <div className="absolute left-0 top-0 z-10 w-full flex items-center justify-end p-2 pointer-events-none">
          {/* Right Controls (Theme, User, Menu) - Pointer events auto */}
          <div className="flex items-center gap-2 pointer-events-auto">
            <ThemeToggle />
            {user && (
              <UserMenu
                user={user}
                isSuperAdmin={isSuperAdmin}
                canManageTenant={canManageTenant}
              />
            )}

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
                          <div onClick={handleMobileAgentsNavigate}>
                            {sidebar}
                          </div>
                        </>
                      )}

                      {/* Show Current Agent Menu (Secondary Sidebar) */}
                      {secondarySidebar && mobileView === 'current-agent' && (
                        <div
                          className="flex-1 overflow-y-auto px-4 py-3"
                          onClick={handleMobileCurrentAgentAction}
                        >
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
    </SecondarySidebarSetterProvider>
  )
}
