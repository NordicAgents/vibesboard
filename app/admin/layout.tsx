import * as React from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Building2, Flag } from 'lucide-react'

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user) {
        redirect('/sign-in')
    }

    // Check if user is super admin
    const isAdmin = await isSuperAdmin(session.user.id)
    if (!isAdmin) {
        redirect('/agents')
    }

    return (
        <div className="flex min-h-screen">
            {/* Sidebar */}
            <aside className="w-64 border-r bg-muted/40">
                <div className="flex h-full flex-col">
                    <div className="border-b p-6">
                        <h2 className="text-lg font-semibold">Admin Dashboard</h2>
                        <p className="text-sm text-muted-foreground">System Management</p>
                    </div>
                    <nav className="flex-1 space-y-1 p-4">
                        <NavLink href="/admin/tenants" icon={Building2}>
                            Tenants
                        </NavLink>
                        <NavLink href="/admin/feature-flags" icon={Flag}>
                            Feature Flags
                        </NavLink>
                    </nav>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
                <div className="container mx-auto p-6 lg:p-8">
                    {children}
                </div>
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
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                'hover:bg-muted hover:text-foreground',
                'text-muted-foreground'
            )}
        >
            <Icon className="h-4 w-4" />
            {children}
        </Link>
    )
}
