'use client'

import * as React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { ChevronRight, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

interface UserAgentUsage {
  messages: number
  inputTokens: number
  outputTokens: number
}

interface UserUsage {
  messages: number
  inputTokens: number
  outputTokens: number
  byAgent: Record<string, UserAgentUsage>
}

interface RollupData {
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  bySource: Record<string, number>
  byAgent: Record<string, number>
  byModel: Record<string, number>
  byUser?: Record<string, UserUsage>
}

interface TenantUsageTabProps {
  tenantId: string
}

interface UserUsageRow {
  id: string
  name: string
  messages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  byAgent: Record<string, UserAgentUsage>
}

function getCurrentCycleId(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function UserAgentBreakdown({
  byAgent,
  agentNames
}: {
  byAgent: Record<string, UserAgentUsage>
  agentNames: Record<string, string>
}) {
  return (
    <div className="border-l-2 border-muted pl-4 py-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="text-left py-1 font-medium">Agent</th>
            <th className="text-right py-1 font-medium">Messages</th>
            <th className="text-right py-1 font-medium">Input Tokens</th>
            <th className="text-right py-1 font-medium">Output Tokens</th>
            <th className="text-right py-1 font-medium">Total Tokens</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(byAgent)
            .sort(
              ([, a], [, b]) =>
                b.inputTokens +
                b.outputTokens -
                (a.inputTokens + a.outputTokens)
            )
            .map(([agentId, usage]) => (
              <tr key={agentId} className="border-t border-muted/50">
                <td className="py-1.5">
                  {agentNames[agentId] || agentId.slice(0, 8)}
                </td>
                <td className="text-right py-1.5">
                  {usage.messages.toLocaleString()}
                </td>
                <td className="text-right py-1.5">
                  {usage.inputTokens.toLocaleString()}
                </td>
                <td className="text-right py-1.5">
                  {usage.outputTokens.toLocaleString()}
                </td>
                <td className="text-right py-1.5">
                  {(usage.inputTokens + usage.outputTokens).toLocaleString()}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

export function TenantUsageTab({ tenantId }: TenantUsageTabProps) {
  const [isLoading, setIsLoading] = React.useState(true)
  const [rollup, setRollup] = React.useState<RollupData | null>(null)
  const [billingCycleId, setBillingCycleId] =
    React.useState(getCurrentCycleId())
  const [agentNames, setAgentNames] = React.useState<Record<string, string>>({})
  const [userNames, setUserNames] = React.useState<Record<string, string>>({})
  const [expandedUsers, setExpandedUsers] = React.useState<Set<string>>(
    new Set()
  )

  React.useEffect(() => {
    async function fetchUsage() {
      try {
        setIsLoading(true)
        // Fetch from the usage endpoint (has user + agent name resolution)
        const res = await fetch(`/api/admin/tenants/${tenantId}/usage`)
        if (!res.ok) throw new Error('Failed to load usage')
        const data = await res.json()
        setRollup(data.rollup ?? null)
        setBillingCycleId(data.billingCycleId ?? getCurrentCycleId())
        setAgentNames(data.agentNames ?? {})
        setUserNames(data.userNames ?? {})
      } catch (err) {
        console.error('Error loading usage:', err)
        toast.error('Failed to load usage data')
      } finally {
        setIsLoading(false)
      }
    }
    fetchUsage()
  }, [tenantId])

  const toggleUser = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />
  }

  if (!rollup) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            No usage data for this billing cycle.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Build user usage rows
  const userUsageRows: UserUsageRow[] = rollup.byUser
    ? Object.entries(rollup.byUser)
        .map(([userId, usage]) => ({
          id: userId,
          name:
            userId === '_anonymous'
              ? 'Anonymous / Public'
              : userId.startsWith('ext:')
                ? userNames[userId] || userId.slice(4, 16)
                : userNames[userId] || userId.slice(0, 8),
          messages: usage.messages ?? 0,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          byAgent: usage.byAgent ?? {}
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens)
    : []

  const userColumns: Column<UserUsageRow>[] = [
    {
      key: 'name',
      label: 'User',
      sortable: true,
      render: row => (
        <div className="flex items-center gap-2">
          {Object.keys(row.byAgent).length > 0 ? (
            expandedUsers.has(row.id) ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )
          ) : (
            <span className="w-4" />
          )}
          <span
            className={
              row.id === '_anonymous' || row.id.startsWith('ext:')
                ? 'text-muted-foreground italic'
                : ''
            }
          >
            {row.name}
          </span>
          {row.id.startsWith('ext:') && (
            <Badge variant="outline" className="ml-1 text-xs">
              external
            </Badge>
          )}
        </div>
      )
    },
    {
      key: 'messages',
      label: 'Messages',
      sortable: true,
      className: 'text-right',
      render: row => row.messages.toLocaleString()
    },
    {
      key: 'inputTokens',
      label: 'Input Tokens',
      sortable: true,
      className: 'text-right',
      render: row => row.inputTokens.toLocaleString()
    },
    {
      key: 'outputTokens',
      label: 'Output Tokens',
      sortable: true,
      className: 'text-right',
      render: row => row.outputTokens.toLocaleString()
    },
    {
      key: 'totalTokens',
      label: 'Total Tokens',
      sortable: true,
      className: 'text-right',
      render: row => row.totalTokens.toLocaleString()
    }
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Usage Details</CardTitle>
          <CardDescription>Billing cycle: {billingCycleId}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Total Messages</p>
              <p className="text-2xl font-medium">
                {rollup.totalMessages.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Input Tokens</p>
              <p className="text-2xl font-medium">
                {rollup.totalInputTokens.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Output Tokens</p>
              <p className="text-2xl font-medium">
                {rollup.totalOutputTokens.toLocaleString()}
              </p>
            </div>
          </div>

          {Object.keys(rollup.bySource).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">By Source</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rollup.bySource)
                  .sort(([, a], [, b]) => b - a)
                  .map(([source, count]) => (
                    <Badge key={source} variant="outline">
                      {source}: {count.toLocaleString()}
                    </Badge>
                  ))}
              </div>
            </div>
          )}

          {Object.keys(rollup.byAgent).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">By Agent</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rollup.byAgent)
                  .sort(([, a], [, b]) => b - a)
                  .map(([agentId, count]) => (
                    <Badge key={agentId} variant="secondary">
                      {agentNames[agentId] || agentId.slice(0, 8)}:{' '}
                      {count.toLocaleString()}
                    </Badge>
                  ))}
              </div>
            </div>
          )}

          {Object.keys(rollup.byModel).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">By Model</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rollup.byModel)
                  .sort(([, a], [, b]) => b - a)
                  .map(([model, count]) => (
                    <Badge key={model} variant="outline">
                      {model}: {count.toLocaleString()}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {userUsageRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Usage by User</CardTitle>
            <CardDescription>
              Token consumption per user with agent breakdown. Click a row to
              expand.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {userColumns.map(col => (
                        <th
                          key={col.key}
                          className={`px-4 py-3 text-left text-sm font-medium ${col.className ?? ''}`}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {userUsageRows.map(row => (
                      <React.Fragment key={row.id}>
                        <tr
                          className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                          onClick={() => toggleUser(row.id)}
                        >
                          {userColumns.map(col => (
                            <td
                              key={col.key}
                              className={`px-4 py-3 text-sm ${col.className ?? ''}`}
                            >
                              {col.render
                                ? col.render(row)
                                : (row as any)[col.key]}
                            </td>
                          ))}
                        </tr>
                        {expandedUsers.has(row.id) &&
                          Object.keys(row.byAgent).length > 0 && (
                            <tr>
                              <td
                                colSpan={userColumns.length}
                                className="px-4 py-2 bg-muted/25"
                              >
                                <UserAgentBreakdown
                                  byAgent={row.byAgent}
                                  agentNames={agentNames}
                                />
                              </td>
                            </tr>
                          )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
