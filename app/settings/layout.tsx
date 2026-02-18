import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Settings, Users, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

async function hasSettingsAccess(userId: string) {
    const supabase = createServerClient()

    // Check if user is super admin or tenant admin via tenant_users
    const { data: userRoles } = await supabase
        .from('tenant_users')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['SUPER_ADMIN', 'TENANT_ADMIN'])

    return userRoles && userRoles.length > 0
}

export default async function SettingsLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const cookieStore = await cookies()
    const session = await auth({ cookieStore })

    if (!session?.user?.id) {
        redirect('/sign-in')
    }

    const hasAccess = await hasSettingsAccess(session.user.id)

    if (!hasAccess) {
        redirect('/') // Redirect to home if no access
    }

    const navItems = [
        {
            title: 'Tenant Settings',
            href: '/settings/tenant',
            icon: Building2,
        },
        {
            title: 'Team Management',
            href: '/settings/tenant/team',
            icon: Users,
        },
    ]

    return (
        <div className="flex min-h-screen">
            {/* Sidebar */}
            <aside className="w-64 border-r bg-muted/40">
                <div className="flex h-16 items-center border-b px-6">
                    <Settings className="mr-2 h-5 w-5" />
                    <h2 className="text-lg font-semibold">Settings</h2>
                </div>
                <nav className="space-y-1 p-4">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                'hover:bg-accent hover:text-accent-foreground'
                            )}
                        >
                            <item.icon className="h-4 w-4" />
                            {item.title}
                        </Link>
                    ))}
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-8">
                {children}
            </main>
        </div>
    )
}
