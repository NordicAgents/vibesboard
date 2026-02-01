import { SidebarList } from '@/components/sidebar-list'
import { ReactNode, Suspense } from 'react'
import { SidebarResizableLayout } from '@/components/layouts/sidebar-resizable-layout'
import { auth } from '@/auth'
import { cookies } from 'next/headers'

interface PersistentSidebarLayoutProps {
  children: ReactNode
  userId: string
}

export async function PersistentSidebarLayout({
  children,
  userId
}: PersistentSidebarLayoutProps) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  return (
    <SidebarResizableLayout
      user={session?.user}
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
