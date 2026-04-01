import * as React from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Building2, Flag, FileText, CreditCard, Palette, ShieldCheck, ArrowLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AdminMobileSidebar, type NavItem } from './admin-mobile-sidebar'

const iconMap: Record<string, LucideIcon> = { Building2, Flag, FileText, CreditCard, Palette }

const navItems: NavItem[] = [
  { href: '/admin/tenants', iconName: 'Building2', label: 'Tenants' },
  { href: '/admin/branding', iconName: 'Palette', label: 'Branding' },
  { href: '/admin/feature-flags', iconName: 'Flag', label: 'Feature Flags' },
  { href: '/admin/plans', iconName: 'CreditCard', label: 'Plans' },
  { href: '/admin/files', iconName: 'FileText', label: 'File Processing' }
]

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const isAdmin = await isSuperAdmin(session.user.id)
  if (!isAdmin) {
    redirect('/agents')
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2.5 border-b border-[#e4e3e3] px-5 dark:border-[#344348]">
          <Link
            href="/agents"
            className="flex size-7 items-center justify-center rounded-lg text-[#6f7f80] transition-colors hover:bg-[#e6ede6] hover:text-[#222f30] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#e6ede6] dark:bg-[#344348]">
            <ShieldCheck className="size-3.5 text-accent-orange" />
          </div>
          <div>
            <h2 className="font-sans text-base font-normal text-[#222f30] dark:text-[#f5f8f7]">
              Admin
            </h2>
            <p className="text-[11px] text-[#6f7f80]">System Management</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          <p className="label-caps mb-2 px-3">Management</p>
          {navItems.map(item => {
            const Icon = iconMap[item.iconName]
            return (
              <NavLink key={item.href} href={item.href} icon={Icon}>
                {item.label}
              </NavLink>
            )
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="flex h-14 items-center gap-3 border-b border-[#e4e3e3] bg-[#f5f8f7] px-4 dark:border-[#344348] dark:bg-[#192425] md:hidden">
          <AdminMobileSidebar navItems={navItems} />
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-[#e6ede6] dark:bg-[#344348]">
              <ShieldCheck className="size-3.5 text-accent-orange" />
            </div>
            <span className="font-sans text-base font-normal text-[#222f30] dark:text-[#f5f8f7]">
              Admin
            </span>
          </div>
        </div>

        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}

function NavLink({
  href,
  icon: Icon,
  children
}: {
  href: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
        'text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30]',
        'dark:text-[#6f7f80] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]'
      )}
    >
      <Icon className="size-4 shrink-0 text-[#6f7f80]" />
      {children}
    </Link>
  )
}
