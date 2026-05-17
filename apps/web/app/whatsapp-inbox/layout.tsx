import { auth } from '@/auth'
import { PersistentSidebarLayout } from '@/components/layouts/persistent-sidebar-layout'
import { redirect } from 'next/navigation'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getActiveTenant } from '@/lib/tenant-context'

export default async function WhatsAppInboxLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const tenantId = await getActiveTenant(session.user.id)
  if (!tenantId) {
    redirect('/agents')
  }

  const hasAccess = await isFeatureEnabled(tenantId, 'WHATSAPP_INBOX')
  if (!hasAccess) {
    redirect('/agents')
  }

  return (
    // @ts-ignore
    <PersistentSidebarLayout userId={session.user.id}>
      {children}
    </PersistentSidebarLayout>
  )
}
