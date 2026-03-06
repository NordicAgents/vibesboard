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
    <header className="sticky top-0 z-50 flex h-16 w-full shrink-0 items-center justify-between border-b border-[#E5E5E5] bg-[#FFFFFF]/80 px-4 backdrop-blur-sm dark:border-[#2A2A2A] dark:bg-[#0A0A0A]/80">
      <div className="flex items-center gap-3">
        {session?.user && (
          <div className="flex items-center gap-2 rounded-none bg-[#F7F7F5] px-2 py-1.5 shadow-sm dark:bg-[#141414] dark:shadow-none">
            <Sidebar>
              <React.Suspense
                fallback={<div className="flex-1 overflow-auto" />}
              >
                {/* @ts-ignore */}
                <SidebarList userId={session?.user?.id} />
              </React.Suspense>
            </Sidebar>
            <div className="h-5 w-px bg-[#E5E5E5] dark:bg-[#2A2A2A]" />
            <Link
              href="/"
              className="px-2 font-sans text-base font-medium tracking-tight text-[#1A1A1A] transition-colors hover:text-[#5A5A5A] dark:text-[#F0F0F0] dark:hover:text-[#A0A0A0]"
            >
              vibesboard
            </Link>
          </div>
        )}
        {!session?.user && (
          <Link
            href="/"
            className="font-sans text-base font-medium tracking-tight text-[#1A1A1A] dark:text-[#F0F0F0] dark:hover:text-[#A0A0A0]"
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
            className="text-sm text-[#5A5A5A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:text-[#A0A0A0] dark:hover:bg-[#1E1E1E] dark:hover:text-[#F0F0F0]"
          >
            <Link href="/sign-in">Login</Link>
          </Button>
        )}
      </div>
    </header>
  )
}
