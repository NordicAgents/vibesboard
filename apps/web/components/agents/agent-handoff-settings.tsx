'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Search } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  filterHandoffAgents,
  type AgentOption,
  type HandoffAgentModeFilter
} from './agent-handoff-filter'

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
  const [query, setQuery] = useState('')
  const [modeFilter, setModeFilter] = useState<HandoffAgentModeFilter>('all')

  useEffect(() => {
    const controller = new AbortController()

    async function fetchAgents() {
      setLoading(true)
      try {
        const res = await fetch(`/api/agents?tenant_id=${tenantId}&limit=50`, {
          signal: controller.signal
        })
        if (!res.ok) return

        const data = await res.json()
        const list = (data.agents ?? [])
          .filter((a: any) => a.id !== agentId)
          .map((a: any) => ({
            id: a.id,
            name: a.name,
            mode: String(a.mode ?? 'provider').toLocaleLowerCase()
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

  const filteredAgents = useMemo(
    () => filterHandoffAgents(agents, query, modeFilter),
    [agents, query, modeFilter]
  )

  const selectedCount = agents.filter(agent =>
    handoffTargets.includes(agent.id)
  ).length

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
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search agents..."
                  aria-label="Search handoff agents"
                  className="pl-9"
                />
              </div>
              <Select
                value={modeFilter}
                onValueChange={value =>
                  setModeFilter(value as HandoffAgentModeFilter)
                }
              >
                <SelectTrigger aria-label="Filter handoff agents by mode">
                  <SelectValue placeholder="All modes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All modes</SelectItem>
                  <SelectItem value="provider">Providers</SelectItem>
                  <SelectItem value="collector">Collectors</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {filteredAgents.length} of {agents.length} agents
              {selectedCount > 0 && ` · ${selectedCount} selected`}
            </p>

            {filteredAgents.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                No agents match your search and filter.
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {filteredAgents.map(a => (
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
