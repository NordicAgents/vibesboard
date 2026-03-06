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
  >('agents')
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
  useEffect(() => {
    isSidebarOpenRef.current = isSidebarOpen
  }, [isSidebarOpen])

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
      <div className="flex h-full flex-1 overflow-hidden">
        <aside
          className={cn(
            'hidden flex-col border-r border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] lg:flex',
            'ease-[cubic-bezier(0.16,1,0.3,1)] transition-[width] duration-300',
            isSidebarOpen ? 'w-[260px]' : 'w-[52px]'
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
                          className="size-9 text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#222f30] dark:text-[#7e8e8f] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
                          onClick={() => handleManualToggle(true)}
                        >
                          <IconSidebar className="size-5" />
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
                          className="size-9 text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#222f30] dark:text-[#7e8e8f] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
                          asChild
                        >
                          <Link href="/agents/create-chat">
                            <IconPlus className="size-5" />
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
                    className="ml-2 font-sans text-base font-medium tracking-tight text-[#222f30] transition-colors hover:text-[#7e8e8f] dark:text-[#f5f8f7] dark:hover:text-[#6f7f80]"
                  >
                    vibesboard
                  </Link>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#222f30] dark:text-[#7e8e8f] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
                          onClick={() => handleManualToggle(false)}
                        >
                          <IconSidebar className="size-5" />
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
                'flex flex-1 flex-col overflow-hidden',
                !isSidebarOpen && 'hidden'
              )}
            >
              {isSidebarOpen && (
                <div className="px-3 pb-2">
                  <Button
                    asChild
                    className="h-10 w-full justify-start border-0 bg-[#222f30] px-4 text-white shadow-none hover:bg-[#344348] dark:bg-[#f5f8f7] dark:text-[#111918] dark:hover:bg-[#e6ede6]"
                  >
                    <Link href="/agents/create-chat">
                      <IconPlus className="mr-2 size-4" />
                      <span>New Agent</span>
                    </Link>
                  </Button>
                </div>
              )}
              <div
                className="flex-1 overflow-y-auto"
                onClick={handlePrimarySidebarNavigate}
              >
                {sidebar}
              </div>
            </div>

            {/* Bottom controls */}
            <div
              className={cn(
                'shrink-0 border-t border-[#e4e3e3] p-2 dark:border-[#344348]',
                isSidebarOpen
                  ? 'flex items-center justify-between'
                  : 'flex flex-col items-center gap-1'
              )}
            >
              {user && (
                <UserMenu
                  user={user}
                  isSuperAdmin={isSuperAdmin}
                  canManageTenant={canManageTenant}
                />
              )}
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f7f7f5] dark:bg-[#111918]">
          {/* Mobile top bar */}
          <div className="pointer-events-none absolute left-0 top-0 z-10 flex w-full items-center justify-end p-2 lg:hidden">
            <div className="pointer-events-auto flex items-center gap-2">
              <ThemeToggle />
              {user && (
                <UserMenu
                  user={user}
                  isSuperAdmin={isSuperAdmin}
                  canManageTenant={canManageTenant}
                />
              )}
              <div>
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#222f30] dark:text-[#7e8e8f] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
                    >
                      <IconMenu className="size-5" />
                      <span className="sr-only">Open Menu</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="left"
                    className="w-[280px] border-r border-[#e4e3e3] bg-[#f5f8f7] p-0 dark:border-[#344348] dark:bg-[#192425]"
                  >
                    <div className="flex h-full flex-col">
                      <div className="flex items-center justify-between border-b border-[#e4e3e3] p-4 dark:border-[#344348]">
                        <Link
                          href="/"
                          className="font-sans text-base font-medium tracking-tight text-[#222f30] dark:text-[#f5f8f7]"
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          vibesboard
                        </Link>
                      </div>

                      {/* View Switcher (Only if secondary sidebar exists) */}
                      {secondarySidebar && (
                        <div className="px-3 py-2">
                          <div className="flex rounded-lg bg-[#e6ede6] p-1 dark:bg-[#344348]">
                            <button
                              onClick={() => setMobileView('agents')}
                              className={cn(
                                'flex-1 rounded-md py-1 text-sm font-medium transition-colors',
                                mobileView === 'agents'
                                  ? 'bg-[#f5f8f7] text-[#222f30] shadow-sm dark:bg-[#192425] dark:text-[#f5f8f7]'
                                  : 'text-[#6f7f80] hover:bg-[#f5f8f7]/50 dark:text-[#7e8e8f] dark:hover:bg-[#192425]/50'
                              )}
                            >
                              Agents
                            </button>
                            <button
                              onClick={() => setMobileView('current-agent')}
                              className={cn(
                                'flex-1 rounded-md py-1 text-sm font-medium transition-colors',
                                mobileView === 'current-agent'
                                  ? 'bg-[#f5f8f7] text-[#222f30] shadow-sm dark:bg-[#192425] dark:text-[#f5f8f7]'
                                  : 'text-[#6f7f80] hover:bg-[#f5f8f7]/50 dark:text-[#7e8e8f] dark:hover:bg-[#192425]/50'
                              )}
                            >
                              Current Agent
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-1 flex-col overflow-hidden">
                        {/* Show Agents List */}
                        {(!secondarySidebar || mobileView === 'agents') && (
                          <>
                            <div className="px-3 py-2">
                              <Button
                                asChild
                                className="h-10 w-full justify-start border-0 bg-[#222f30] px-4 text-white shadow-none hover:bg-[#344348] dark:bg-[#f5f8f7] dark:text-[#111918] dark:hover:bg-[#e6ede6]"
                              >
                                <Link
                                  href="/agents/create-chat"
                                  onClick={() => setMobileMenuOpen(false)}
                                >
                                  <IconPlus className="mr-2 size-4" />
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
