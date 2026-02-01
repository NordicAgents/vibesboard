import { SidebarList } from '@/components/sidebar-list'
import { ReactNode, Suspense } from 'react'
import { SidebarResizableLayout } from '@/components/layouts/sidebar-resizable-layout'

interface PersistentSidebarLayoutProps {
  children: ReactNode
  userId: string
}

export function PersistentSidebarLayout({
  children,
  userId
}: PersistentSidebarLayoutProps) {
  return (
    <SidebarResizableLayout
      sidebar={
        <Suspense fallback={<div className="flex-1" />}>
          {/* @ts-ignore */}
          <SidebarList userId={userId} />
        </Suspense>
      }
    >
      {children}
    </SidebarResizableLayout>
  )
}
