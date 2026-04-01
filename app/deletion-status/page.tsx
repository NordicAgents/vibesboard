'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'

interface DeletionStatus {
  confirmation_code: string
  status: 'pending' | 'completed' | 'failed'
  created_at: string | null
  completed_at: string | null
}

function DeletionStatusContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const [data, setData] = useState<DeletionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setError('No deletion request ID provided.')
      setLoading(false)
      return
    }

    fetch(`/api/meta/data-deletion/status?id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Deletion request not found.')
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <p className="text-text-secondary">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        <div className="mx-auto max-w-md rounded-2xl bg-bg-surface p-8 shadow-sm">
          <h1 className="font-serif text-xl font-semibold text-text-primary">
            Data Deletion Status
          </h1>
          <p className="mt-4 text-text-secondary">{error}</p>
        </div>
      </div>
    )
  }

  const statusConfig = {
    pending: {
      label: 'In Progress',
      color: 'text-amber-600',
      description: 'Your data deletion request is being processed.',
    },
    completed: {
      label: 'Completed',
      color: 'text-green-600',
      description: 'Your data has been successfully deleted.',
    },
    failed: {
      label: 'Failed',
      color: 'text-red-600',
      description:
        'There was an issue processing your request. Please contact support.',
    },
  }

  const status = data ? statusConfig[data.status] : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base">
      <div className="mx-auto max-w-md rounded-2xl bg-bg-surface p-8 shadow-sm">
        <h1 className="font-serif text-xl font-semibold text-text-primary">
          Data Deletion Status
        </h1>

        {data && status && (
          <div className="mt-6 space-y-4">
            <div>
              <p className="text-sm text-text-tertiary">Status</p>
              <p className={`text-lg font-medium ${status.color}`}>
                {status.label}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {status.description}
              </p>
            </div>

            <div>
              <p className="text-sm text-text-tertiary">Confirmation Code</p>
              <p className="font-mono text-sm text-text-primary">
                {data.confirmation_code}
              </p>
            </div>

            {data.created_at && (
              <div>
                <p className="text-sm text-text-tertiary">Requested</p>
                <p className="text-sm text-text-primary">
                  {new Date(data.created_at).toLocaleString()}
                </p>
              </div>
            )}

            {data.completed_at && (
              <div>
                <p className="text-sm text-text-tertiary">Completed</p>
                <p className="text-sm text-text-primary">
                  {new Date(data.completed_at).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DeletionStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-bg-base">
          <p className="text-text-secondary">Loading...</p>
        </div>
      }
    >
      <DeletionStatusContent />
    </Suspense>
  )
}
