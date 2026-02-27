import * as React from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Building2, Flag, FileText, ShieldCheck } from 'lucide-react'

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

    return (
        <div className="flex min-h-screen bg-[#F5F0E8] dark:bg-[#1A1915]">
            {/* Sidebar */}
            <aside className="hidden w-64 shrink-0 border-r border-[#E2DDD4] bg-[#FDFAF5] dark:border-[#2E2B25] dark:bg-[#221F1A] md:flex md:flex-col">
                <div className="flex h-16 items-center gap-2.5 border-b border-[#E2DDD4] px-5 dark:border-[#2E2B25]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EDE8DE] dark:bg-[#2E2B25]">
                        <ShieldCheck className="h-3.5 w-3.5 text-[#D97757]" />
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
                    <NavLink href="/admin/tenants" icon={Building2}>
                        Tenants
                    </NavLink>
                    <NavLink href="/admin/feature-flags" icon={Flag}>
                        Feature Flags
                    </NavLink>
                    <NavLink href="/admin/files" icon={FileText}>
                        File Processing
                    </NavLink>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto p-6 lg:p-8">
                {children}
            </main>
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
            <Icon className="h-4 w-4 shrink-0 text-[#9D9790]" />
            {children}
        </Link>
    )
}
