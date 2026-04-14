import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isSuperAdmin } from '@/lib/permissions'
import { AdminFileMonitor } from '@/components/admin/admin-file-monitor'

export const metadata: Metadata = {
  title: 'File Processing Monitor - Admin',
  description: 'Monitor and manage file processing for RAG system'
}

export default async function AdminFilesPage() {
  const session = await auth()

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
        <p className="mt-2 text-muted-foreground">
          Monitor and manually trigger RAG file processing across all agents
        </p>
      </div>

      <AdminFileMonitor />
    </div>
  )
}
