'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AgentConfigureTab } from '@/components/agents/agent-configure-tab'
import { AgentIntegrationsTab } from '@/components/agents/agent-integrations-tab'
import type { AgentSharePayload, VibeAgent } from '@/lib/types'

interface AgentDashboardTabsProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  defaultTab?: string
}

export function AgentDashboardTabs({
  agent,
  share,
  canEdit,
  defaultTab = 'configure'
}: AgentDashboardTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.push(`/agents/${agent.id}?${params.toString()}`)
  }

  return (
    <div>
      <div className="mb-2">
        <p className="text-xs uppercase text-muted-foreground">Agent</p>
        <h2 className="text-lg font-semibold">{agent.name}</h2>
        {!canEdit && (
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only (ask a tenant admin to edit).
          </p>
        )}
      </div>

      <Tabs
        defaultValue={defaultTab}
        onValueChange={handleTabChange}
      >
        <TabsList>
          <TabsTrigger value="configure">Configure</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="configure">
          <AgentConfigureTab agent={agent} share={share} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="integrations">
          <AgentIntegrationsTab agent={agent} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
