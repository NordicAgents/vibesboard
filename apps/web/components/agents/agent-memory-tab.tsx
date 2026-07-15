'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'react-hot-toast'
import { Check, X, Brain, Clock } from 'lucide-react'

interface HybridMemory {
  id: string
  key: string
  description: string
  content: string
  presenceClass: 'omnipresent' | 'pattern' | 'on-demand'
  scope: 'org' | 'member'
  subScopeId: string | null
  importance: number
  createdAt: string
}

interface PendingMutation {
  id: string
  scopeId: string
  subScopeId: string | null
  mutation: {
    operation: 'add' | 'modify' | 'delete'
    memory?: { key: string; content: string; presenceClass: string }
    memoryId?: string
    patch?: { content?: string; key?: string; presenceClass?: string }
  }
  approver: string
  status: string
  createdAt: string
}

const PRESENCE_COLORS: Record<string, string> = {
  omnipresent: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 ring-purple-500/30 ring-1',
  pattern: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 ring-blue-500/30 ring-1',
  'on-demand': 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 ring-zinc-500/30 ring-1',
}

interface AgentMemoryTabProps {
  agentId: string
  memoryEnabled: boolean
  canEdit: boolean
}

export function AgentMemoryTab({ agentId, memoryEnabled, canEdit }: AgentMemoryTabProps) {
  const [memories, setMemories] = useState<HybridMemory[]>([])
  const [mutations, setMutations] = useState<PendingMutation[]>([])
  const [loadingMemories, setLoadingMemories] = useState(true)
  const [loadingMutations, setLoadingMutations] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const fetchMemories = useCallback(async () => {
    setLoadingMemories(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/memory`)
      if (res.ok) setMemories((await res.json()).memories ?? [])
    } catch { /* silent */ }
    finally { setLoadingMemories(false) }
  }, [agentId])

  const fetchMutations = useCallback(async () => {
    setLoadingMutations(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/memory/mutations`)
      if (res.ok) setMutations((await res.json()).mutations ?? [])
    } catch { /* silent */ }
    finally { setLoadingMutations(false) }
  }, [agentId])

  useEffect(() => {
    if (memoryEnabled) {
      fetchMemories()
      fetchMutations()
    } else {
      setLoadingMemories(false)
      setLoadingMutations(false)
    }
  }, [memoryEnabled, fetchMemories, fetchMutations])

  const handleMutation = async (mutationId: string, action: 'approve' | 'reject') => {
    setActing(mutationId)
    try {
      const res = await fetch(`/api/agents/${agentId}/memory/mutations/${mutationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      toast.success(action === 'approve' ? 'Mutation approved' : 'Mutation rejected')
      fetchMutations()
      if (action === 'approve') fetchMemories()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(null)
    }
  }

  if (!memoryEnabled) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Brain className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Memory is disabled for this agent. Enable it in the Setup tab.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5 py-4">
      {/* Pending mutations */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Pending Mutations</CardTitle>
              <CardDescription className="mt-1">
                Proposed memory changes extracted from conversations. Review and approve or reject each one.
              </CardDescription>
            </div>
            {mutations.length > 0 && (
              <Badge variant="secondary">{mutations.length}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingMutations ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : mutations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending mutations.</p>
          ) : (
            <div className="divide-y">
              {mutations.map((m) => {
                const op = m.mutation.operation
                const content = op === 'add'
                  ? m.mutation.memory?.content
                  : op === 'modify'
                    ? m.mutation.patch?.content
                    : `Delete memory ${m.mutation.memoryId?.slice(0, 8)}…`
                const key = op === 'add'
                  ? m.mutation.memory?.key
                  : m.mutation.patch?.key ?? m.mutation.memoryId

                return (
                  <div key={m.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={op === 'delete' ? 'destructive' : op === 'add' ? 'default' : 'secondary'}
                          className="text-xs capitalize">{op}</Badge>
                        {key && <span className="text-xs font-mono text-muted-foreground">{key}</span>}
                        {m.subScopeId && (
                          <span className="text-xs text-muted-foreground">visitor: {m.subScopeId.slice(0, 12)}…</span>
                        )}
                      </div>
                      {content && (
                        <p className="mt-1 text-sm line-clamp-2">{content}</p>
                      )}
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(m.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-green-500/50 text-green-700 dark:text-green-400 hover:bg-green-500/10"
                          disabled={acting === m.id}
                          onClick={() => handleMutation(m.id, 'approve')}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-red-500/50 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                          disabled={acting === m.id}
                          onClick={() => handleMutation(m.id, 'reject')}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stored memories */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Stored Memories</CardTitle>
              <CardDescription className="mt-1">
                Long-term memories built from approved mutations.
              </CardDescription>
            </div>
            {memories.length > 0 && (
              <Badge variant="secondary">{memories.length}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingMemories ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No memories yet. Approve pending mutations to create memories.
            </p>
          ) : (
            <div className="divide-y">
              {memories.map((mem) => (
                <div key={mem.id} className="py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{mem.key}</span>
                    <Badge className={`text-xs ${PRESENCE_COLORS[mem.presenceClass] ?? ''}`}>
                      {mem.presenceClass}
                    </Badge>
                    {mem.subScopeId && (
                      <Badge variant="outline" className="text-xs">visitor</Badge>
                    )}
                  </div>
                  {mem.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{mem.description}</p>
                  )}
                  <p className="mt-1 text-sm line-clamp-3">{mem.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
