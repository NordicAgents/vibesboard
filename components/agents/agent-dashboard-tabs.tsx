'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AgentSetupTab } from '@/components/agents/agent-setup-tab'
import { AgentKnowledgeTab } from '@/components/agents/agent-knowledge-tab'
import { AgentNotificationSettings } from '@/components/agents/agent-notification-settings'
import { AgentReviewsTab } from '@/components/agents/agent-reviews-tab'
import { AgentShareTab } from '@/components/agents/agent-share-tab'
import { AgentIntegrationsTab } from '@/components/agents/agent-integrations-tab'
import { AgentHandoffSettings } from '@/components/agents/agent-handoff-settings'
import { AgentSchedulingSettings } from '@/components/agents/agent-scheduling-settings'
import { AgentDataSettings } from '@/components/agents/agent-data-settings'
import { FeatureGate } from '@/components/tenants/feature-gate-client'
import { useAgentForm } from '@/lib/hooks/use-agent-form'
import type { AgentSharePayload, VibeAgent } from '@/lib/types'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AgentDashboardTabsProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  defaultTab?: string
  onSwitchToFocus?: () => void
}

const SAVEABLE_TABS = ['setup', 'knowledge', 'notifications', 'reviews', 'actions']

// Sub-sections within the Actions tab
const ACTION_SECTIONS = ['scheduling', 'data'] as const
type ActionSection = (typeof ACTION_SECTIONS)[number]

export function AgentDashboardTabs({
  agent,
  share,
  canEdit,
  defaultTab = 'setup',
  onSwitchToFocus
}: AgentDashboardTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Resolve legacy tab values
  const resolvedDefault =
    defaultTab === 'configure' ? 'setup'
    : defaultTab === 'scheduling' || defaultTab === 'data' ? 'actions'
    : defaultTab
  const [activeTab, setActiveTab] = useState(resolvedDefault)
  const [actionSection, setActionSection] = useState<ActionSection>(
    defaultTab === 'data' ? 'data' : 'scheduling'
  )

  const form = useAgentForm(agent)
  const { fields, setters, hasChanges, saving, isDeleting, handleSaveAll, handleDelete } = form

  // ── Tab navigation ──
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.push(`/agents/${agent.id}?${params.toString()}`)
  }

  const showSaveBar = SAVEABLE_TABS.includes(activeTab)

  return (
    <div>
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Agent</p>
            <h2 className="text-lg font-semibold">{agent.name}</h2>
          </div>
          {onSwitchToFocus && (
            <button
              onClick={onSwitchToFocus}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              Simple view
            </button>
          )}
        </div>
        {!canEdit && (
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only (ask a tenant admin to edit).
          </p>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {/* Sticky save bar — shown on tabs with saveable form state */}
        {showSaveBar && (
          <div className="sticky top-0 z-20 mt-3 flex justify-end border-b bg-background/95 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <Button
              onClick={handleSaveAll}
              disabled={saving || !hasChanges || !canEdit}
              className="rounded-full"
              size="sm"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}

        <TabsContent value="setup">
          <AgentSetupTab
            name={fields.name}
            onNameChange={setters.setName}
            instructions={fields.instructions}
            onInstructionsChange={setters.setInstructions}
            greetingText={fields.greetingText}
            onGreetingTextChange={setters.setGreetingText}
            allowAnonymous={fields.allowAnonymous}
            onAllowAnonymousChange={setters.setAllowAnonymous}
            mode={fields.mode}
            onModeChange={setters.setMode}
            maxResponses={fields.maxResponses}
            onMaxResponsesChange={setters.setMaxResponses}
            maxAgentResponses={fields.maxAgentResponses}
            onMaxAgentResponsesChange={setters.setMaxAgentResponses}
            totalResponseCount={agent.totalResponseCount}
            quickSuggestionsMode={fields.quickSuggestionsMode}
            onQuickSuggestionsModeChange={setters.setQuickSuggestionsMode}
            quickSuggestionsCount={fields.quickSuggestionsCount}
            onQuickSuggestionsCountChange={setters.setQuickSuggestionsCount}
            collectionFields={fields.collectionFields}
            onCollectionFieldsChange={setters.setCollectionFields}
            tenantSlug={agent.tenantSlug}
            agentUrl={agent.agentUrl}
            saving={saving}
            canEdit={canEdit}
          />
          {agent.tenantId && (
            <FeatureGate
              feature="AGENT_HANDOFF"
              tenantId={agent.tenantId}
            >
              <div className="mt-5">
                <AgentHandoffSettings
                  agentId={agent.id}
                  tenantId={agent.tenantId}
                  handoffTargets={fields.handoffTargets}
                  onChange={setters.setHandoffTargets}
                  disabled={saving || !canEdit}
                />
              </div>
            </FeatureGate>
          )}
        </TabsContent>

        <TabsContent value="knowledge">
          <AgentKnowledgeTab
            agent={agent}
            canEdit={canEdit}
            sourceUrls={fields.sourceUrls}
            onSourceUrlsChange={setters.setSourceUrls}
          />
        </TabsContent>

        <TabsContent value="notifications">
          <div className="space-y-5 pb-8">
            {agent.tenantId ? (
              <FeatureGate
                feature="AGENT_NOTIFICATIONS"
                tenantId={agent.tenantId}
              >
                <AgentNotificationSettings
                  config={fields.notificationConfig}
                  onChange={setters.setNotificationConfig}
                  disabled={saving || !canEdit}
                  tenantId={agent.tenantId}
                />
              </FeatureGate>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Notifications require a tenant. Assign this agent to a tenant
                first.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reviews">
          <AgentReviewsTab
            googleReviewEnabled={fields.googleReviewEnabled}
            onGoogleReviewEnabledChange={setters.setGoogleReviewEnabled}
            googlePlaceId={fields.googlePlaceId}
            onGooglePlaceIdChange={setters.setGooglePlaceId}
            saving={saving}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="actions">
          {agent.tenantId ? (
            <div className="space-y-4">
              {/* Sub-navigation for action sections */}
              <div className="flex gap-2">
                {ACTION_SECTIONS.map((section) => (
                  <button
                    key={section}
                    onClick={() => setActionSection(section)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-all duration-150',
                      actionSection === section
                        ? 'border-accent-orange/30 bg-accent-orange/10 text-accent-orange'
                        : 'border-border bg-card text-muted-foreground hover:bg-hover hover:text-foreground'
                    )}
                  >
                    {section === 'scheduling' ? 'Scheduling' : 'Data'}
                  </button>
                ))}
              </div>

              {actionSection === 'scheduling' && (
                <FeatureGate
                  feature="AGENT_ACTIONS_SCHEDULE"
                  tenantId={agent.tenantId}
                >
                  <AgentSchedulingSettings
                    config={fields.schedulingConfig}
                    onChange={setters.setSchedulingConfig}
                    disabled={saving || !canEdit}
                    tenantId={agent.tenantId}
                  />
                </FeatureGate>
              )}

              {actionSection === 'data' && (
                <FeatureGate
                  feature="AGENT_ACTIONS_DATA"
                  tenantId={agent.tenantId}
                >
                  <AgentDataSettings
                    config={fields.dataConfig}
                    onChange={setters.setDataConfig}
                    disabled={saving || !canEdit}
                    tenantId={agent.tenantId}
                    collectionFields={fields.collectionFields}
                  />
                </FeatureGate>
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Actions require a tenant. Assign this agent to a tenant first.
            </p>
          )}
        </TabsContent>

        <TabsContent value="share">
          <AgentShareTab
            agent={agent}
            share={share}
            canEdit={canEdit}
            isDeleting={isDeleting}
            onDelete={handleDelete}
          />
        </TabsContent>

        <TabsContent value="integrations">
          <AgentIntegrationsTab agent={agent} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
