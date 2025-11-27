import * as React from 'react'
import Link from 'next/link'

import { auth } from '@/auth'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/sidebar'
import { SidebarList } from '@/components/sidebar-list'
import { SidebarFooter } from '@/components/sidebar-footer'
import { ThemeToggle } from '@/components/theme-toggle'
import { UserMenu } from '@/components/user-menu'
import { cookies } from 'next/headers'

export async function Header() {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })
  return (
    <header className="sticky top-0 z-50 flex h-16 w-full shrink-0 items-center justify-between border-b border-black-10 bg-beige-bg/80 px-4 backdrop-blur-sm dark:border-border dark:bg-background/80">
      <div className="flex items-center gap-3">
        {session?.user && (
          <div className="flex items-center gap-2 rounded-2xl bg-purewhite-bg px-2 py-1.5 shadow-sm dark:bg-gray-800 dark:shadow-none">
            <Sidebar>
              <React.Suspense fallback={<div className="flex-1 overflow-auto" />}>
                {/* @ts-ignore */}
                <SidebarList userId={session?.user?.id} />
              </React.Suspense>
              <SidebarFooter>
                <ThemeToggle />
              </SidebarFooter>
            </Sidebar>
            <div className="h-5 w-px bg-black-10 dark:bg-gray-600" />
            <Link href="/" className="px-2 font-switzer text-base font-bold tracking-tight text-black-primary transition-colors hover:text-gray-secondary dark:text-white dark:hover:text-gray-300">
              vibesboard
            </Link>
          </div>
        )}
        {!session?.user && (
          <Link href="/" className="font-switzer text-xl font-bold tracking-tight text-black-primary dark:text-white dark:hover:text-gray-300">
            vibesboard
          </Link>
        )}
      </div>
      <div className="flex items-center justify-end space-x-2">
        {session?.user ? (
          <UserMenu user={session.user} />
        ) : (
          <Button variant="link" asChild className="-ml-2">
            <Link href="/sign-in">Login</Link>
          </Button>
        )}
      </div>
    </header>
  )
}
