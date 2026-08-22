import { SidebarList } from '@/components/sidebar-list'
import { ReactNode, Suspense } from 'react'
import { SidebarResizableLayout } from '@/components/layouts/sidebar-resizable-layout'
import { TenantSwitcher } from '@/components/tenants'
import { SidebarFooterMenu } from '@/components/sidebar-footer-menu'
import { auth } from '@/auth'
import { SidebarProvider } from '@/components/sidebar-context'
import {
  getActiveTenant,
  getUserTenants,
  enrichTenantsWithMembers
} from '@/lib/tenant-context'
import {
  hasTenantAdminAccess,
  isSuperAdmin
} from '@vibesboard/policy/permissions'

interface PersistentSidebarLayoutProps {
  children: ReactNode
  userId: string
}

export async function PersistentSidebarLayout({
  children,
  userId
}: PersistentSidebarLayoutProps) {
  const session = await auth()
  const [isSuperAdminUser, canManageTenant] = session?.user?.id
    ? await Promise.all([
        isSuperAdmin(session.user.id),
        hasTenantAdminAccess(session.user.id)
      ])
    : [false, false]

  // Workspace switcher data for the sidebar footer. TenantSwitcher renders
  // null when the user has fewer than 2 workspaces unless extraContent is set,
  // which it always is here (so the footer controls stay reachable).
  const currentTenantId = userId ? await getActiveTenant(userId) : null
  const rawTenants = userId ? await getUserTenants(userId) : []
  const tenants =
    rawTenants.length > 0 ? await enrichTenantsWithMembers(rawTenants) : []

  return (
    <SidebarProvider>
      <SidebarResizableLayout
        user={session?.user}
        isSuperAdmin={isSuperAdminUser}
        canManageTenant={canManageTenant}
        footerSwitcher={
          <TenantSwitcher
            tenants={tenants}
            currentTenantId={currentTenantId}
            className="w-full"
            showWorkspaceList={false}
            extraContent={
              session?.user ? (
                <SidebarFooterMenu
                  user={session.user}
                  isSuperAdmin={isSuperAdminUser}
                  canManageTenant={canManageTenant}
                />
              ) : null
            }
          />
        }
        sidebar={
          <Suspense fallback={<div className="flex-1" />}>
            {/* @ts-ignore */}
            <SidebarList userId={userId} />
          </Suspense>
        }
      >
        {children}
      </SidebarResizableLayout>
    </SidebarProvider>
  )
}
