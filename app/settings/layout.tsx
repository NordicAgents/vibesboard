import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Settings, Users, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsMobileSidebar } from './settings-mobile-sidebar'

import { auth } from '@/auth'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type TenantDocument } from '@/lib/firestore-types'
import { TenantSwitcher } from '@/components/tenants'
import { getActiveTenant, getTenantById } from '@/lib/tenant-context'
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

 const [manageableTenants, activeTenantId] = await Promise.all([
 getManageableTenants(session.user.id),
 getActiveTenant(session.user.id)
 ])

 const activeTenant = activeTenantId
 ? await getTenantById(activeTenantId)
 : null

 const isActivePersonal = Boolean(activeTenant?.isPersonal)
 let teamCollaborationEnabled = true
 if (activeTenantId) {
 try {
 teamCollaborationEnabled = await isFeatureEnabled(
 activeTenantId,
 'TEAM_COLLABORATION'
 )
 } catch {
 teamCollaborationEnabled = true
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
 ...(!isActivePersonal && teamCollaborationEnabled
 ? [
 {
 title: 'Team Management',
 href: '/settings/tenant/team',
 icon: Users,
 iconName: 'Users' as const
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
 <div className="flex h-full overflow-hidden bg-[#f7f7f5]">
 {/* Desktop Sidebar */}
 <aside className="hidden w-64 shrink-0 border-r border-border-warm bg-bg-surface md:flex md:flex-col">
 {/* Header */}
 <div className="flex h-16 items-center gap-2.5 border-b border-border-warm px-5">
 <div className="flex size-7 items-center justify-center rounded-lg bg-bg-hover">
 <Settings className="size-3.5 text-accent-orange" />
 </div>
 <h2 className="font-sans text-base font-normal text-text-primary">
 Settings
 </h2>
 </div>

 {/* Workspace Switcher */}
 <div className="border-b border-border-warm p-3">
 <TenantSwitcher
 tenants={manageableTenants}
 currentTenantId={activeTenantId}
 className="w-full"
 />
 {!canManageActiveTenant && (
 <p className="mt-2 px-1 text-xs text-text-tertiary">
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
 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
 ''
 )}
 >
 <item.icon className="size-4 shrink-0 text-text-tertiary" />
 {item.title}
 </Link>
 ))}
 </nav>
 </aside>

 {/* Main Content */}
 <div className="flex flex-1 flex-col overflow-hidden">
 {/* Mobile Header */}
 <div className="flex h-14 items-center gap-3 border-b border-border-warm bg-bg-surface px-4 md:hidden">
 <SettingsMobileSidebar navItems={mobileNavItems} />
 <div className="flex items-center gap-2">
 <div className="flex size-6 items-center justify-center rounded bg-bg-hover">
 <Settings className="size-3.5 text-accent-orange" />
 </div>
 <span className="font-sans text-base font-normal text-text-primary">
 Settings
 </span>
 </div>
 </div>

 <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
 {!canManageActiveTenant && (
 <div className="mb-6 rounded-xl border border-border-warm bg-bg-surface p-4 text-sm text-text-secondary">
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
