'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { RotateCcw, Clock } from 'lucide-react'

interface AgentVersion {
  versionNo: number
  source: string
  changeNote: string | null
  restoredFrom: number | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

interface AgentVersionHistoryTabProps {
  agentId: string
  currentVersion: number
  canEdit: boolean
}

const SOURCE_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  restore: 'Restored',
  backfill: 'Backfill',
  'file-sync': 'File sync',
  system: 'System'
}

export function AgentVersionHistoryTab({
  agentId,
  currentVersion,
  canEdit
}: AgentVersionHistoryTabProps) {
  const router = useRouter()
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)

  const fetchVersions = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/agents/${agentId}/versions?limit=50`)
      if (!res.ok) throw new Error('Failed to load versions')
      const data = await res.json()
      setVersions(data.versions ?? [])
    } catch {
      const message = 'Failed to load version history'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    fetchVersions()
  }, [fetchVersions])

  const handleRestore = async (versionNo: number) => {
    if (!canEdit) return
    if (
      !confirm(
        `Restore to version ${versionNo}? This will create a new version.`
      )
    )
      return
    setRestoring(versionNo)
    try {
      const res = await fetch(
        `/api/agents/${agentId}/versions/${versionNo}/restore`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Restore failed')
      if (data.warnings?.length) {
        toast.success(
          `Restored to v${versionNo}. Some file keys were missing: ${data.warnings.join(', ')}`
        )
      } else {
        toast.success(`Restored to version ${versionNo}`)
      }
      router.refresh()
      fetchVersions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading version history…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="py-4">
        <Card role="alert" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">
              Version history unavailable
            </CardTitle>
            <CardDescription>{loadError}. Please try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={fetchVersions}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Version History</CardTitle>
          <CardDescription>
            Every configuration change creates a new version. Restoring creates
            a new forward version.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No version history yet.
            </p>
          ) : (
            <div className="divide-y">
              {versions.map(v => (
                <div
                  key={v.versionNo}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {v.versionNo}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {SOURCE_LABELS[v.source] ?? v.source}
                        </Badge>
                        {v.versionNo === currentVersion && (
                          <Badge className="bg-green-500 text-xs text-white dark:bg-green-600">
                            Current
                          </Badge>
                        )}
                        {v.restoredFrom != null && (
                          <span className="text-xs text-muted-foreground">
                            ← from v{v.restoredFrom}
                          </span>
                        )}
                      </div>
                      {v.changeNote && (
                        <p className="mt-1 text-sm text-foreground">
                          {v.changeNote}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        <span>{new Date(v.createdAt).toLocaleString()}</span>
                        {v.createdByName && <span>· {v.createdByName}</span>}
                      </div>
                    </div>
                  </div>
                  {canEdit && v.versionNo !== currentVersion && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={restoring === v.versionNo}
                      onClick={() => handleRestore(v.versionNo)}
                    >
                      <RotateCcw className="mr-1.5 size-3" />
                      {restoring === v.versionNo ? 'Restoring…' : 'Restore'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
