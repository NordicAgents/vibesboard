import * as React from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Building2, Flag, FileText, ShieldCheck } from 'lucide-react'
import { AdminMobileSidebar } from './admin-mobile-sidebar'

export default async function AdminLayout({
    children,
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

    const navItems = [
        { href: '/admin/tenants', icon: Building2, label: 'Tenants' },
        { href: '/admin/feature-flags', icon: Flag, label: 'Feature Flags' },
        { href: '/admin/files', icon: FileText, label: 'File Processing' },
    ]

    return (
        <div className="flex h-full overflow-hidden bg-[#F5F0E8] dark:bg-[#1A1915]">
            {/* Desktop Sidebar */}
            <aside className="hidden w-64 shrink-0 border-r border-[#E2DDD4] bg-[#FDFAF5] dark:border-[#2E2B25] dark:bg-[#221F1A] md:flex md:flex-col">
                <div className="flex h-16 items-center gap-2.5 border-b border-[#E2DDD4] px-5 dark:border-[#2E2B25]">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-[#EDE8DE] dark:bg-[#2E2B25]">
                        <ShieldCheck className="size-3.5 text-accent-orange" />
                    </div>
                    <div>
                        <h2 className="font-serif text-base font-normal text-[#1A1915] dark:text-[#E8E3D8]">
                            Admin
                        </h2>
                        <p className="text-[11px] text-[#9D9790]">System Management</p>
                    </div>
                </div>

                <nav className="flex-1 space-y-0.5 p-3">
                    <p className="label-caps mb-2 px-3">Management</p>
                    {navItems.map((item) => (
                        <NavLink key={item.href} href={item.href} icon={item.icon}>
                            {item.label}
                        </NavLink>
                    ))}
                </nav>
            </aside>

            {/* Main Content */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* Mobile Header */}
                <div className="flex h-14 items-center gap-3 border-b border-[#E2DDD4] bg-[#FDFAF5] px-4 dark:border-[#2E2B25] dark:bg-[#221F1A] md:hidden">
                    <AdminMobileSidebar navItems={navItems} />
                    <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded bg-[#EDE8DE] dark:bg-[#2E2B25]">
                            <ShieldCheck className="size-3.5 text-accent-orange" />
                        </div>
                        <span className="font-serif text-base font-normal text-[#1A1915] dark:text-[#E8E3D8]">Admin</span>
                    </div>
                </div>

                <main className="flex-1 overflow-auto p-6 lg:p-8">
                    {children}
                </main>
            </div>
        </div>
    )
}

function NavLink({
    href,
    icon: Icon,
    children,
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
                'text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915]',
                'dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]'
            )}
        >
            <Icon className="size-4 shrink-0 text-[#9D9790]" />
            {children}
        </Link>
    )
}
