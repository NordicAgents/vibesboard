import * as React from 'react'
import Link from 'next/link'

import { auth } from '@/auth'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { SidebarList } from '@/components/sidebar-list'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserMenu } from '@/components/user-menu'
import { hasTenantAdminAccess, isSuperAdmin } from '@/lib/permissions'

export async function Header() {
  const session = await auth()
  const [isSuperAdminUser, canManageTenant] = session?.user?.id
    ? await Promise.all([
        isSuperAdmin(session.user.id),
        hasTenantAdminAccess(session.user.id)
      ])
    : [false, false]

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full shrink-0 items-center justify-between border-b border-[#E2DDD4] bg-[#F5F0E8]/80 px-4 backdrop-blur-sm dark:border-[#2E2B25] dark:bg-[#1A1915]/80">
      <div className="flex items-center gap-3">
        {session?.user && (
          <div className="flex items-center gap-2 rounded-xl bg-[#FDFAF5] px-2 py-1.5 shadow-sm dark:bg-[#221F1A] dark:shadow-none">
            <Sidebar>
              <React.Suspense
                fallback={<div className="flex-1 overflow-auto" />}
              >
                {/* @ts-ignore */}
                <SidebarList userId={session?.user?.id} />
              </React.Suspense>
            </Sidebar>
            <div className="h-5 w-px bg-[#E2DDD4] dark:bg-[#2E2B25]" />
            <Link
              href="/"
              className="px-2 font-serif text-base font-normal text-[#1A1915] transition-colors hover:text-[#6B6560] dark:text-[#E8E3D8] dark:hover:text-[#9D9790]"
            >
              vibesboard
            </Link>
          </div>
        )}
        {!session?.user && (
          <Link
            href="/"
            className="font-serif text-base font-normal text-[#1A1915] dark:text-[#E8E3D8] dark:hover:text-[#9D9790]"
          >
            vibesboard
          </Link>
        )}
      </div>
      <div className="flex items-center justify-end space-x-2">
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
            className="text-sm text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]"
          >
            <Link href="/sign-in">Login</Link>
          </Button>
        )}
      </div>
    </header>
  )
}
