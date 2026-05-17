import { SidebarList } from '@/components/sidebar-list'
import { ReactNode, Suspense } from 'react'
import { SidebarResizableLayout } from '@/components/layouts/sidebar-resizable-layout'
import { auth } from '@/auth'
import { SidebarProvider } from '@/components/sidebar-context'
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

  return (
    <SidebarProvider>
      <SidebarResizableLayout
        user={session?.user}
        isSuperAdmin={isSuperAdminUser}
        canManageTenant={canManageTenant}
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
