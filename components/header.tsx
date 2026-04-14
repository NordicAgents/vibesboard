import * as React from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'

import { auth } from '@/auth'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { SidebarList } from '@/components/sidebar-list'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserMenu } from '@/components/user-menu'
import { hasTenantAdminAccess, isSuperAdmin } from '@/lib/permissions'
import { getActiveTenantId } from '@/lib/tenant-context'
import { FeatureGate } from '@/components/tenants/feature-gate-client'
import { NotificationBell } from '@/components/notifications/notification-bell'

export async function Header() {
  const session = await auth()
  const [isSuperAdminUser, canManageTenant, activeTenantId] = session?.user?.id
    ? await Promise.all([
        isSuperAdmin(session.user.id),
        hasTenantAdminAccess(session.user.id),
        getActiveTenantId()
      ])
    : [false, false, null]

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full shrink-0 items-center justify-between border-b border-[#e4e3e3] bg-[#f7f7f5]/80 px-4 backdrop-blur-sm dark:border-[#344348] dark:bg-[#111918]/80">
      <div className="flex items-center gap-3">
        {session?.user && (
          <div className="flex items-center gap-2 rounded-none bg-[#f5f8f7] px-2 py-1.5 shadow-sm dark:bg-[#192425] dark:shadow-none">
            <Sidebar>
              <React.Suspense
                fallback={<div className="flex-1 overflow-auto" />}
              >
                {/* @ts-ignore */}
                <SidebarList userId={session?.user?.id} />
              </React.Suspense>
            </Sidebar>
            <div className="h-5 w-px bg-[#e4e3e3] dark:bg-[#344348]" />
            <Link
              href="/"
              className="px-2 font-sans text-base font-medium tracking-tight text-[#222f30] transition-colors hover:text-[#445e5f] dark:text-[#f5f8f7] dark:hover:text-[#c9cbbe]"
            >
              vibesboard
            </Link>
          </div>
        )}
        {!session?.user && (
          <Link
            href="/"
            className="font-sans text-base font-medium tracking-tight text-[#222f30] dark:text-[#f5f8f7] dark:hover:text-[#c9cbbe]"
          >
            vibesboard
          </Link>
        )}
      </div>
      <div className="flex items-center justify-end space-x-2">
        {session?.user && activeTenantId && (
          <FeatureGate feature="AGENT_NOTIFICATIONS" tenantId={activeTenantId}>
            <NotificationBell tenantId={activeTenantId} />
          </FeatureGate>
        )}
        <ThemeToggle />
        {session?.user ? (
          <UserMenu
            user={session.user}
            isSuperAdmin={isSuperAdminUser}
            canManageTenant={canManageTenant}
          />
        ) : (
          <Button
            variant="ghost"
            asChild
            className="text-sm text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] dark:text-[#c9cbbe] dark:hover:bg-[#253435] dark:hover:text-[#f5f8f7]"
          >
            <Link href="/sign-in">Login</Link>
          </Button>
        )}
      </div>
    </header>
  )
}
