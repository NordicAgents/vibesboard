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
import { AgentBookingEnquiries } from '@/components/agents/agent-booking-enquiries'
import { AgentActionsFlow } from '@/components/agents/agent-actions-flow'
import { FeatureGate } from '@/components/tenants/feature-gate-client'
import { useAgentForm } from '@/lib/hooks/use-agent-form'
import { useTenantFeatures } from '@/hooks/use-tenant-features'
import type { AgentSharePayload, VibeAgent } from '@vibesboard/contracts'
import { ArrowLeft } from 'lucide-react'
import type { ActionCapability } from '@vibesboard/agents/action-config'

interface AgentDashboardTabsProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  defaultTab?: string
  onSwitchToFocus?: () => void
}

const SAVEABLE_TABS = [
  'setup',
  'knowledge',
  'notifications',
  'reviews',
  'actions'
]

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
    defaultTab === 'configure'
      ? 'setup'
      : defaultTab === 'scheduling' || defaultTab === 'data'
        ? 'actions'
        : defaultTab === 'booking-enquiries'
          ? 'booking-enquiries'
          : defaultTab
  const [activeTab, setActiveTab] = useState(resolvedDefault)
  const initialActionCapability: ActionCapability =
    defaultTab === 'data'
      ? 'data'
      : defaultTab === 'scheduling'
        ? 'scheduling'
        : 'booking'

  // Hide tabs whose feature is disabled for the tenant — there's nothing to
  // configure, so the tab would otherwise render an empty panel.
  const { isEnabled: isTenantFeatureEnabled, loading: featuresLoading } =
    useTenantFeatures(agent.tenantId ?? null)
  const actionsEnabled =
    !!agent.tenantId && isTenantFeatureEnabled('AGENT_ACTIONS')

  const form = useAgentForm(agent)
  const {
    fields,
    setters,
    hasChanges,
    saving,
    isDeleting,
    handleSaveAll,
    handleDelete
  } = form

  // ── Tab navigation ──
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.push(`/agents/${agent.id}?${params.toString()}`)
  }

  // A tab is only renderable if its content exists. The Actions tab depends on
  // the async AGENT_ACTIONS feature (off by default now); Enquiries depends on
  // bookingConfig. If the active tab has no content — e.g. a deep-linked
  // ?tab=actions, or a legacy scheduling/data link that resolves to actions, on
  // a tenant where actions are disabled — clamp to Setup so we never render a
  // blank panel with an orphaned save bar. Don't clamp the Actions tab while
  // features are still loading, so a valid actions deep-link isn't bounced on
  // first paint.
  const isTabAvailable = (tab: string): boolean => {
    if (tab === 'actions') return actionsEnabled
    if (tab === 'booking-enquiries') return !!agent.bookingConfig?.enabled
    return true
  }
  const effectiveTab =
    isTabAvailable(activeTab) || (activeTab === 'actions' && featuresLoading)
      ? activeTab
      : 'setup'

  const showSaveBar = SAVEABLE_TABS.includes(effectiveTab)

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

      <Tabs value={effectiveTab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          {actionsEnabled && <TabsTrigger value="actions">Actions</TabsTrigger>}
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
          {agent.bookingConfig?.enabled && (
            <TabsTrigger value="booking-enquiries">Enquiries</TabsTrigger>
          )}
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
            agentId={agent.id}
            hasAccessPassword={!!agent.accessPassword}
            llmConfigId={fields.llmConfigId}
            onLlmConfigIdChange={setters.setLlmConfigId}
            tenantId={agent.tenantId}
            memoryEnabled={fields.memoryEnabled}
            onMemoryEnabledChange={setters.setMemoryEnabled}
          />
          {agent.tenantId && (
            <FeatureGate feature="AGENT_HANDOFF" tenantId={agent.tenantId}>
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

        {actionsEnabled && agent.tenantId && (
          <TabsContent value="actions">
            <AgentActionsFlow
              schedulingConfig={fields.schedulingConfig}
              onSchedulingConfigChange={setters.setSchedulingConfig}
              dataConfig={fields.dataConfig}
              onDataConfigChange={setters.setDataConfig}
              calendarAvailabilityConfig={fields.calendarAvailabilityConfig}
              onCalendarAvailabilityConfigChange={
                setters.setCalendarAvailabilityConfig
              }
              bookingConfig={fields.bookingConfig}
              onBookingConfigChange={setters.setBookingConfig}
              disabled={saving || !canEdit}
              tenantId={agent.tenantId}
              collectionFields={fields.collectionFields}
              initialCapability={initialActionCapability}
              allowAnonymous={fields.allowAnonymous}
              onGoToSetup={() => handleTabChange('setup')}
            />
          </TabsContent>
        )}

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

        {agent.bookingConfig?.enabled && (
          <TabsContent value="booking-enquiries">
            <AgentBookingEnquiries agentId={agent.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
