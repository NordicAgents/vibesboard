'use client'

import { useEffect, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AgentOption {
  id: string
  name: string
  mode: string
}

interface AgentHandoffSettingsProps {
  agentId: string
  tenantId: string
  handoffTargets: string[]
  onChange: (targets: string[]) => void
  disabled: boolean
}

export function AgentHandoffSettings({
  agentId,
  tenantId,
  handoffTargets,
  onChange,
  disabled
}: AgentHandoffSettingsProps) {
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchAgents() {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/agents?tenant_id=${tenantId}&limit=50`,
          { signal: controller.signal }
        )
        if (!res.ok) return

        const data = await res.json()
        const list = (data.agents ?? [])
          .filter((a: any) => a.id !== agentId)
          .map((a: any) => ({
            id: a.id,
            name: a.name,
            mode: a.mode ?? 'provider'
          }))
        setAgents(list)
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return
        console.error('Failed to fetch agents:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchAgents()
    return () => controller.abort()
  }, [tenantId, agentId])

  const toggleTarget = (id: string) => {
    if (disabled) return
    const next = handoffTargets.includes(id)
      ? handoffTargets.filter(t => t !== id)
      : [...handoffTargets, id]
    onChange(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="size-4" />
          Agent Handoff
        </CardTitle>
        <CardDescription>
          Select agents this agent can transfer conversations to when the
          request is outside its scope.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Loading agents...
          </p>
        ) : agents.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No other agents in this tenant. Create another agent first.
          </p>
        ) : (
          <div className="space-y-3">
            {agents.map(a => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-bg-hover"
              >
                <input
                  type="checkbox"
                  checked={handoffTargets.includes(a.id)}
                  onChange={() => toggleTarget(a.id)}
                  disabled={disabled}
                  className="size-4 rounded border-border accent-accent-orange"
                />
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {a.mode}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
