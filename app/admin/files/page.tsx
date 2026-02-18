import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import { AdminFileMonitor } from '@/components/admin/admin-file-monitor'

export const metadata: Metadata = {
  title: 'File Processing Monitor - Admin',
  description: 'Monitor and manage file processing for RAG system'
}

export default async function AdminFilesPage() {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const isAdmin = await isSuperAdmin(session.user.id)
  if (!isAdmin) {
    redirect('/')
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">File Processing Monitor</h1>
        <p className="text-muted-foreground mt-2">
          Monitor and manually trigger RAG file processing across all agents
        </p>
      </div>

      <AdminFileMonitor />
    </div>
  )
}
