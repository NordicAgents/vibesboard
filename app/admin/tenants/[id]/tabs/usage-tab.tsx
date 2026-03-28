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
import toast from 'react-hot-toast'

interface RollupData {
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  bySource: Record<string, number>
  byAgent: Record<string, number>
  byModel: Record<string, number>
}

interface TenantUsageTabProps {
  tenantId: string
}

function getCurrentCycleId(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function TenantUsageTab({ tenantId }: TenantUsageTabProps) {
  const [isLoading, setIsLoading] = React.useState(true)
  const [rollup, setRollup] = React.useState<RollupData | null>(null)
  const [billingCycleId, setBillingCycleId] = React.useState(getCurrentCycleId())

  React.useEffect(() => {
    async function fetchUsage() {
      try {
        setIsLoading(true)
        const res = await fetch(`/api/admin/tenants/${tenantId}/subscription`)
        if (!res.ok) throw new Error('Failed to load usage')
        const data = await res.json()
        setRollup(data.rollup ?? null)
        setBillingCycleId(data.billingCycleId ?? getCurrentCycleId())
      } catch (err) {
        console.error('Error loading usage:', err)
        toast.error('Failed to load usage data')
      } finally {
        setIsLoading(false)
      }
    }
    fetchUsage()
  }, [tenantId])

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />
  }

  if (!rollup) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No usage data for this billing cycle.</p>
        </CardContent>
      </Card>
    )
  }

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
              <p className="text-2xl font-medium">{rollup.totalMessages.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Input Tokens</p>
              <p className="text-2xl font-medium">{rollup.totalInputTokens.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Output Tokens</p>
              <p className="text-2xl font-medium">{rollup.totalOutputTokens.toLocaleString()}</p>
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
                      {agentId.slice(0, 8)}: {count.toLocaleString()}
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
    </div>
  )
}
