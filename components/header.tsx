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
 <header className="sticky top-0 z-50 flex h-16 w-full shrink-0 items-center justify-between border-b border-border-warm bg-[#f7f7f5]/80 px-4 backdrop-blur-sm dark:bg-[#111918]/80">
 <div className="flex items-center gap-3">
 {session?.user && (
 <div className="flex items-center gap-2 rounded-none bg-bg-surface px-2 py-1.5 shadow-sm dark:shadow-none">
 <Sidebar>
 <React.Suspense
 fallback={<div className="flex-1 overflow-auto" />}
 >
 {/* @ts-ignore */}
 <SidebarList userId={session?.user?.id} />
 </React.Suspense>
 </Sidebar>
 <div className="h-5 w-px bg-[#e4e3e3]" />
 <Link
 href="/"
 className="px-2 font-sans text-base font-medium tracking-tight text-text-primary transition-colors hover:text-text-secondary"
 >
 vibesboard
 </Link>
 </div>
 )}
 {!session?.user && (
 <Link
 href="/"
 className="font-sans text-base font-medium tracking-tight text-text-primary"
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
 className="text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary"
 >
 <Link href="/sign-in">Login</Link>
 </Button>
 )}
 </div>
 </header>
 )
}
