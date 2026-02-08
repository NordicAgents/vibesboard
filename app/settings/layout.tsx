import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Settings, Users, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TenantSwitcher } from '@/components/tenants'
import { getActiveTenant } from '@/lib/tenant-context'
import { hasTenantAdminAccess } from '@/lib/permissions'
import { isFeatureEnabled } from '@/lib/features'

async function getManageableTenants(userId: string) {
    const supabase = createServerClient()

    const { data } = await supabase
        .from('tenant_users')
        .select('tenant_id, role, tenants(*)')
        .eq('user_id', userId)
        .in('role', ['SUPER_ADMIN', 'TENANT_ADMIN'])

    return (data ?? [])
        .map((row: any) => row.tenants)
        .filter(Boolean)
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

    const hasAccess = await hasTenantAdminAccess(session.user.id)

    if (!hasAccess) {
        redirect('/') // Redirect to home if no access
    }

    const [manageableTenants, activeTenantId] = await Promise.all([
        getManageableTenants(session.user.id),
        getActiveTenant(session.user.id)
    ])

    const supabase = createServerClient()
    const { data: activeTenant } = activeTenantId
        ? await supabase
              .from('tenants')
              .select('id, is_personal')
              .eq('id', activeTenantId)
              .maybeSingle()
        : { data: null as any }

    const isActivePersonal = Boolean(activeTenant?.is_personal)
    let teamCollaborationEnabled = true
    if (activeTenantId) {
        try {
            teamCollaborationEnabled = await isFeatureEnabled(activeTenantId, 'TEAM_COLLABORATION')
        } catch {
            teamCollaborationEnabled = true
        }
    }

    const canManageActiveTenant = Boolean(
        activeTenantId && manageableTenants.some((t: any) => t.id === activeTenantId)
    )

    const navItems = [
        {
            title: 'Tenant Settings',
            href: '/settings/tenant',
            icon: Building2,
        },
        ...(!isActivePersonal && teamCollaborationEnabled ? [{
            title: 'Team Management',
            href: '/settings/tenant/team',
            icon: Users,
        }] : []),
    ]

    return (
        <div className="flex min-h-screen">
            {/* Sidebar */}
            <aside className="w-64 border-r bg-muted/40">
                <div className="flex h-16 items-center border-b px-6">
                    <Settings className="mr-2 h-5 w-5" />
                    <h2 className="text-lg font-semibold">Settings</h2>
                </div>
                <div className="border-b p-4">
                    <TenantSwitcher
                        tenants={manageableTenants}
                        currentTenantId={activeTenantId}
                        className="w-full"
                    />
                    {!canManageActiveTenant && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            Switch to a workspace you can manage.
                        </p>
                    )}
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
                {!canManageActiveTenant && (
                    <div className="mb-6 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                        You do not have admin access to the active workspace. Use the workspace switcher to select a workspace you can manage.
                    </div>
                )}
                {children}
            </main>
        </div>
    )
}
