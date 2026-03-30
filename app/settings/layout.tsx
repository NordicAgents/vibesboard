import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Settings, Users, Building2, Link2, BarChart3, CreditCard, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsMobileSidebar } from './settings-mobile-sidebar'

import { auth } from '@/auth'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type TenantDocument } from '@/lib/firestore-types'
import { TenantSwitcher } from '@/components/tenants'
import { getActiveTenant, getTenantById, enrichTenantsWithMembers } from '@/lib/tenant-context'
import { hasTenantAdminAccess } from '@/lib/permissions'
import { isFeatureEnabled } from '@/lib/features'

async function getManageableTenants(userId: string): Promise<TenantDocument[]> {
  const membersSnapshot = await adminDb
    .collectionGroup('members')
    .where('userId', '==', userId)
    .where('role', 'in', ['SUPER_ADMIN', 'TENANT_ADMIN'])
    .get()

  if (membersSnapshot.empty) return []

  const tenantIds = membersSnapshot.docs.map(
    doc => doc.data().tenantId as string
  )

  const tenantDocs = await Promise.all(
    tenantIds.map(id => adminDb.collection(Collections.tenants).doc(id).get())
  )

  return tenantDocs
    .filter(doc => doc.exists)
    .map(doc => doc.data() as TenantDocument)
}

export default async function SettingsLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/sign-in')
  }

  const hasAccess = await hasTenantAdminAccess(session.user.id)

  if (!hasAccess) {
    redirect('/')
  }

  const [rawManageableTenants, activeTenantId] = await Promise.all([
    getManageableTenants(session.user.id),
    getActiveTenant(session.user.id)
  ])

  const manageableTenants = rawManageableTenants.length > 0
    ? await enrichTenantsWithMembers(rawManageableTenants)
    : []

  const activeTenant = activeTenantId
    ? await getTenantById(activeTenantId)
    : null

  const isActivePersonal = Boolean(activeTenant?.isPersonal)
  let teamCollaborationEnabled = true
  let agentLinksEnabled = false
  if (activeTenantId) {
    try {
      ;[teamCollaborationEnabled, agentLinksEnabled] = await Promise.all([
        isFeatureEnabled(activeTenantId, 'TEAM_COLLABORATION'),
        isFeatureEnabled(activeTenantId, 'AGENT_LINKS')
      ])
    } catch {
      teamCollaborationEnabled = true
      agentLinksEnabled = false
    }
  }

  const canManageActiveTenant = Boolean(
    activeTenantId && manageableTenants.some(t => t.id === activeTenantId)
  )

  const navItems = [
    {
      title: 'Tenant Settings',
      href: '/settings/tenant',
      icon: Building2,
      iconName: 'Building2' as const
    },
    {
      title: 'Usage',
      href: '/settings/tenant/usage',
      icon: BarChart3,
      iconName: 'BarChart3' as const
    },
    {
      title: 'Billing',
      href: '/settings/tenant/billing',
      icon: CreditCard,
      iconName: 'CreditCard' as const
    },
    ...(!isActivePersonal && teamCollaborationEnabled
      ? [
          {
            title: 'Team Management',
            href: '/settings/tenant/team',
            icon: Users,
            iconName: 'Users' as const
          }
        ]
      : []),
    ...(!isActivePersonal && agentLinksEnabled
      ? [
          {
            title: 'Agent Links',
            href: '/settings/tenant/agent-links',
            icon: Link2,
            iconName: 'Link2' as const
          }
        ]
      : [])
  ]

  const mobileNavItems = navItems.map(({ title, href, iconName }) => ({
    title,
    href,
    icon: iconName
  }))

  return (
    <div className="flex h-full overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] md:flex md:flex-col">
        {/* Header */}
        <div className="flex h-16 items-center gap-2.5 border-b border-[#e4e3e3] px-5 dark:border-[#344348]">
          <Link
            href="/agents"
            className="flex size-7 items-center justify-center rounded-lg text-[#6f7f80] transition-colors hover:bg-[#e6ede6] hover:text-[#222f30] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#e6ede6] dark:bg-[#344348]">
            <Settings className="size-3.5 text-accent-orange" />
          </div>
          <h2 className="font-sans text-base font-normal text-[#222f30] dark:text-[#f5f8f7]">
            Settings
          </h2>
        </div>

        {/* Workspace Switcher */}
        <div className="border-b border-[#e4e3e3] p-3 dark:border-[#344348]">
          <TenantSwitcher
            tenants={manageableTenants}
            currentTenantId={activeTenantId}
            className="w-full"
          />
          {!canManageActiveTenant && (
            <p className="mt-2 px-1 text-xs text-[#6f7f80]">
              Switch to a workspace you can manage.
            </p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 p-3">
          <p className="label-caps mb-2 px-3">Navigation</p>
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                'text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30]',
                'dark:text-[#6f7f80] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]'
              )}
            >
              <item.icon className="size-4 shrink-0 text-[#6f7f80]" />
              {item.title}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="flex h-14 items-center gap-3 border-b border-[#e4e3e3] bg-[#f5f8f7] px-4 dark:border-[#344348] dark:bg-[#192425] md:hidden">
          <SettingsMobileSidebar navItems={mobileNavItems} />
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-[#e6ede6] dark:bg-[#344348]">
              <Settings className="size-3.5 text-accent-orange" />
            </div>
            <span className="font-sans text-base font-normal text-[#222f30] dark:text-[#f5f8f7]">
              Settings
            </span>
          </div>
        </div>

        <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
          {!canManageActiveTenant && (
            <div className="mb-6 rounded-xl border border-[#e4e3e3] bg-[#f5f8f7] p-4 text-sm text-[#445e5f] dark:border-[#344348] dark:bg-[#192425] dark:text-[#6f7f80]">
              You do not have admin access to the active workspace. Use the
              workspace switcher to select a workspace you can manage.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
