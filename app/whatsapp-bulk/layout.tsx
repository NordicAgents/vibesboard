import { auth } from '@/auth'
import { PersistentSidebarLayout } from '@/components/layouts/persistent-sidebar-layout'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isFeatureEnabled } from '@/lib/features'
import { getActiveTenant } from '@/lib/tenant-context'

export default async function WhatsAppBulkLayout({
  children
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  // Check if feature is enabled for the active tenant
  const tenantId = await getActiveTenant(session.user.id)
  if (!tenantId) {
    redirect('/agents')
  }

  const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging')
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
