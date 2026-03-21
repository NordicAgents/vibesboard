import { auth } from '@/auth'
import { PersistentSidebarLayout } from '@/components/layouts/persistent-sidebar-layout'
import { redirect } from 'next/navigation'

export default async function ChatLayout({
 children
}: {
 children: React.ReactNode
}) {
 const session = await auth()

 if (!session?.user) {
 redirect('/sign-in')
 }

 return (
 // @ts-ignore
 <PersistentSidebarLayout userId={session.user.id}>
 {children}
 </PersistentSidebarLayout>
 )
}
