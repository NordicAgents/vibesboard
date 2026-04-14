'use client'

import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Copy, Plus, Trash2, Power, PowerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { formatDate } from '@/lib/utils'

interface Hook {
  id: string
  name: string
  status: 'active' | 'inactive'
  requestCount: number
  lastUsedAt?: string
  createdAt: string
}

interface AgentHooksSettingsProps {
  agentId: string
  canEdit: boolean
}

export function AgentHooksSettings({
  agentId,
  canEdit
}: AgentHooksSettingsProps) {
  const [hooks, setHooks] = useState<Hook[]>([])
  const [loading, setLoading] = useState(true)

  // Create flow
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newHookName, setNewHookName] = useState('')
  const [creating, setCreating] = useState(false)

  // Secret reveal dialog (shown once after creation)
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<{
    hookId: string
    name: string
    secretKey: string
  } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)

  const loadHooks = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/agents/${agentId}/hooks`)
      if (!res.ok) throw new Error('Failed to load hooks')
      const data = await res.json()
      setHooks(data.hooks ?? [])
    } catch {
      toast.error('Failed to load hooks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHooks()
  }, [agentId])

  const handleCreate = async () => {
    if (!newHookName.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHookName.trim() })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to create hook')
      }
      const data = await res.json()
      setShowCreateDialog(false)
      setNewHookName('')

      // Show secret once
      setRevealedSecret({
        hookId: data.hook.id,
        name: data.hook.name,
        secretKey: data.secretKey
      })
      setSecretDialogOpen(true)
      setSecretCopied(false)

      await loadHooks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create hook')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleStatus = async (hook: Hook) => {
    const newStatus = hook.status === 'active' ? 'inactive' : 'active'
    try {
      const res = await fetch(`/api/agents/${agentId}/hooks/${hook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (!res.ok) throw new Error('Failed to update hook')
      setHooks(prev =>
        prev.map(h => (h.id === hook.id ? { ...h, status: newStatus } : h))
      )
      toast.success(newStatus === 'active' ? 'Hook enabled' : 'Hook disabled')
    } catch {
      toast.error('Failed to update hook')
    }
  }

  const handleDelete = async (hookId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/hooks/${hookId}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to delete hook')
      setHooks(prev => prev.filter(h => h.id !== hookId))
      toast.success('Hook deleted')
    } catch {
      toast.error('Failed to delete hook')
    }
  }

  const handleCopySecret = async () => {
    if (!revealedSecret) return
    try {
      await navigator.clipboard.writeText(revealedSecret.secretKey)
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 1500)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Hooks</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                Secret-authenticated endpoints for external and agent-to-agent
                access.
              </CardDescription>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  setNewHookName('')
                  setShowCreateDialog(true)
                }}
              >
                <Plus className="mr-1 size-3.5" />
                New Hook
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Loading...
            </p>
          ) : hooks.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No hooks yet. Create one to expose this agent externally.
            </p>
          ) : (
            <div className="space-y-2">
              {hooks.map(hook => (
                <div
                  key={hook.id}
                  className="flex items-start justify-between rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {hook.name}
                      </span>
                      <Badge
                        variant={
                          hook.status === 'active' ? 'default' : 'secondary'
                        }
                        className="shrink-0 text-[10px]"
                      >
                        {hook.status}
                      </Badge>
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {hook.id}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {hook.requestCount} request
                      {hook.requestCount !== 1 ? 's' : ''}
                      {hook.lastUsedAt
                        ? ` · last used ${formatDate(hook.lastUsedAt)}`
                        : ' · never used'}
                    </p>
                  </div>

                  {canEdit && (
                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title={
                          hook.status === 'active'
                            ? 'Disable hook'
                            : 'Enable hook'
                        }
                        onClick={() => handleToggleStatus(hook)}
                      >
                        {hook.status === 'active' ? (
                          <PowerOff className="size-3.5 text-muted-foreground" />
                        ) : (
                          <Power className="size-3.5 text-muted-foreground" />
                        )}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Delete hook"
                          >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete hook?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Any external service using &ldquo;{hook.name}
                              &rdquo; will immediately lose access. This cannot
                              be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 hover:bg-red-700"
                              onClick={e => {
                                e.preventDefault()
                                handleDelete(hook.id)
                              }}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create hook dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Hook</DialogTitle>
            <DialogDescription>
              Give this hook a label so you know which integration it belongs
              to.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g. Negotiation Service"
            value={newHookName}
            onChange={e => setNewHookName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !newHookName.trim()}
            >
              {creating ? 'Creating...' : 'Create Hook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret reveal dialog — shown once */}
      <Dialog
        open={secretDialogOpen}
        onOpenChange={open => {
          if (!open) {
            setSecretDialogOpen(false)
            setRevealedSecret(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hook Created — Save Your Secret</DialogTitle>
            <DialogDescription>
              This is the only time the secret key will be shown. Copy it now
              and store it securely. You cannot retrieve it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Hook ID
              </p>
              <p className="font-mono text-sm">{revealedSecret?.hookId}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Secret Key
              </p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
                <code className="flex-1 break-all font-mono text-xs">
                  {revealedSecret?.secretKey}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onClick={handleCopySecret}
                >
                  <Copy className="mr-1.5 size-3.5" />
                  {secretCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <p className="text-xs text-amber-800 dark:text-amber-400">
                Pass this as the{' '}
                <code className="font-mono">X-Hook-Secret</code> header when
                calling{' '}
                <code className="font-mono">
                  POST /api/hooks/{revealedSecret?.hookId}/chat
                </code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSecretDialogOpen(false)}>
              I&apos;ve saved the secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
