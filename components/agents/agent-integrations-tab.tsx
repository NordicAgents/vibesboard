'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAvailableIntegrations } from '@/lib/integrations/helpers'
import type {
  IntegrationConnectionSummary,
  IntegrationDefinition
} from '@/lib/integrations/types'
import { FeatureGate } from '@/components/tenants/feature-gate-client'
import { IntegrationCard } from '@/components/agents/integration-card'
import { AgentChatwootSettings } from '@/components/agents/agent-chatwoot-settings'
import { AgentEmbedSettings } from '@/components/agents/agent-embed-settings'
import { AgentHooksSettings } from '@/components/agents/agent-hooks-settings'
import type { VibeAgent } from '@/lib/types'

interface AgentIntegrationsTabProps {
  agent: VibeAgent
  canEdit: boolean
}

export function AgentIntegrationsTab({
  agent,
  canEdit
}: AgentIntegrationsTabProps) {
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(
    null
  )
  const [statuses, setStatuses] = useState<
    Record<string, IntegrationConnectionSummary>
  >({})

  const integrations = getAvailableIntegrations()

  // Fetch integration statuses
  useEffect(() => {
    let cancelled = false
    async function fetchStatuses() {
      try {
        const res = await fetch(
          `/api/agents/${agent.id}/integrations/status`
        )
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const map: Record<string, IntegrationConnectionSummary> = {}
        for (const s of data.integrations) {
          map[s.type] = s
        }
        setStatuses(map)
      } catch {
        // silently fail — cards just show without status badges
      }
    }
    fetchStatuses()
    return () => {
      cancelled = true
    }
  }, [agent.id])

  const handleSelect = (type: string) => {
    setSelectedIntegration(prev => (prev === type ? null : type))
  }

  const renderSettingsPanel = (definition: IntegrationDefinition) => {
    switch (definition.type) {
      case 'chatwoot':
        return <AgentChatwootSettings agentId={agent.id} canEdit={canEdit} agentName={agent.name} />
      case 'embed_widget':
        return <AgentEmbedSettings agent={agent} canEdit={canEdit} />
      case 'hooks':
        return <AgentHooksSettings agentId={agent.id} canEdit={canEdit} />
      default:
        return null
    }
  }

  const renderIntegrationCard = (definition: IntegrationDefinition) => {
    const status = statuses[definition.type]
    const isSelected = selectedIntegration === definition.type

    const card = (
      <div key={definition.type}>
        <IntegrationCard
          definition={definition}
          isSelected={isSelected}
          onSelect={() => handleSelect(definition.type)}
          activeConnections={status?.activeConnections}
          configured={status?.configured}
        />
        {/* Accordion panel */}
        <div
          className={cn(
            'grid transition-all duration-200 ease-in-out',
            isSelected
              ? 'grid-rows-[1fr] opacity-100 mt-3'
              : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className="overflow-hidden">
            {isSelected && (
              <div className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium">
                    {definition.name} Settings
                  </h3>
                  <button
                    onClick={() => setSelectedIntegration(null)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown className="size-4 rotate-180" />
                  </button>
                </div>
                {renderSettingsPanel(definition)}
              </div>
            )}
          </div>
        </div>
      </div>
    )

    // Wrap in FeatureGate if the integration has a feature flag
    if (definition.featureFlag) {
      return (
        <FeatureGate
          key={definition.type}
          feature={definition.featureFlag}
          tenantId={agent.tenantId!}
        >
          {card}
        </FeatureGate>
      )
    }

    return card
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h2 className="text-sm font-medium">Available Integrations</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect your agent to external platforms and services.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {integrations.map(renderIntegrationCard)}
      </div>
    </div>
  )
}
