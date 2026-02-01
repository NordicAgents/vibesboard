import { auth } from '@/auth'
import { PersistentSidebarLayout } from '@/components/layouts/persistent-sidebar-layout'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function AgentsLayout({
  children
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  return (
    <PersistentSidebarLayout userId={session.user.id}>
      {children}
    </PersistentSidebarLayout>
  )
}
