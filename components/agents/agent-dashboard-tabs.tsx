'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AgentSetupTab } from '@/components/agents/agent-setup-tab'
import { AgentKnowledgeTab } from '@/components/agents/agent-knowledge-tab'
import { AgentNotificationSettings } from '@/components/agents/agent-notification-settings'
import { AgentReviewsTab } from '@/components/agents/agent-reviews-tab'
import { AgentShareTab } from '@/components/agents/agent-share-tab'
import { AgentIntegrationsTab } from '@/components/agents/agent-integrations-tab'
import { AgentHandoffSettings } from '@/components/agents/agent-handoff-settings'
import { FeatureGate } from '@/components/tenants/feature-gate-client'
import type {
  AgentSharePayload,
  VibeAgent,
  AgentMode,
  QuickSuggestionsMode
} from '@/lib/types'
import type { AgentNotificationConfig } from '@/lib/firestore-types'

interface AgentDashboardTabsProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  defaultTab?: string
}

const SAVEABLE_TABS = ['setup', 'knowledge', 'notifications', 'reviews']

export function AgentDashboardTabs({
  agent,
  share,
  canEdit,
  defaultTab = 'setup'
}: AgentDashboardTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Resolve legacy "configure" tab value to "setup"
  const resolvedDefault =
    defaultTab === 'configure' ? 'setup' : defaultTab
  const [activeTab, setActiveTab] = useState(resolvedDefault)

  // ── Form state ──
  const [name, setName] = useState(agent.name)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [greetingText, setGreetingText] = useState(
    agent.greetingText ?? 'Hi How can i help you today'
  )
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
  const [mode, setMode] = useState<AgentMode>(agent.mode || 'provider')
  const [maxMessages, setMaxMessages] = useState<number | null>(
    agent.maxMessages ?? null
  )
  const [quickSuggestionsMode, setQuickSuggestionsMode] =
    useState<QuickSuggestionsMode>(agent.quickSuggestionsMode ?? 'off')
  const [quickSuggestionsCount, setQuickSuggestionsCount] = useState<number>(
    agent.quickSuggestionsCount ?? 4
  )
  const [googleReviewEnabled, setGoogleReviewEnabled] = useState(
    agent.googleReviewEnabled ?? false
  )
  const [googlePlaceId, setGooglePlaceId] = useState(
    agent.googlePlaceId ?? ''
  )
  const [sourceUrls, setSourceUrls] = useState<string[]>(
    agent.sourceUrls ?? []
  )
  const [notificationConfig, setNotificationConfig] = useState<
    AgentNotificationConfig | undefined
  >(agent.notificationConfig as AgentNotificationConfig | undefined)
  const [handoffTargets, setHandoffTargets] = useState<string[]>(
    agent.handoffTargets ?? []
  )
  const [saving, setSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // ── Change detection ──
  const hasChanges =
    name !== agent.name ||
    instructions !== agent.instructions ||
    greetingText.trim() !==
      (agent.greetingText?.trim() ?? 'Hi How can i help you today') ||
    allowAnonymous !== agent.allowAnonymous ||
    mode !== (agent.mode || 'provider') ||
    maxMessages !== (agent.maxMessages ?? null) ||
    quickSuggestionsMode !== (agent.quickSuggestionsMode ?? 'off') ||
    quickSuggestionsCount !== (agent.quickSuggestionsCount ?? 4) ||
    googleReviewEnabled !== (agent.googleReviewEnabled ?? false) ||
    (googlePlaceId.trim() || null) !== (agent.googlePlaceId ?? null) ||
    JSON.stringify(sourceUrls) !== JSON.stringify(agent.sourceUrls ?? []) ||
    JSON.stringify(notificationConfig) !==
      JSON.stringify(agent.notificationConfig ?? undefined) ||
    JSON.stringify(handoffTargets) !==
      JSON.stringify(agent.handoffTargets ?? [])

  // ── Save all ──
  const handleSaveAll = async () => {
    setSaving(true)
    const payload: Partial<VibeAgent> = {
      name,
      instructions,
      greetingText: greetingText.trim() || null,
      allowAnonymous,
      mode,
      maxMessages,
      quickSuggestionsMode,
      quickSuggestionsCount,
      googleReviewEnabled,
      googlePlaceId: googlePlaceId.trim() || null,
      sourceUrls,
      notificationConfig,
      handoffTargets
    }

    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error ?? 'Failed to update')
      }
      router.refresh()
    } catch {
      // keep silent
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──
  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to delete agent')
      toast.success('Agent deleted')
      router.push('/')
      router.refresh()
    } catch {
      toast.error('Failed to delete agent')
      setIsDeleting(false)
    }
  }

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
        <p className="text-xs uppercase text-muted-foreground">Agent</p>
        <h2 className="text-lg font-semibold">{agent.name}</h2>
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
            name={name}
            onNameChange={setName}
            instructions={instructions}
            onInstructionsChange={setInstructions}
            greetingText={greetingText}
            onGreetingTextChange={setGreetingText}
            allowAnonymous={allowAnonymous}
            onAllowAnonymousChange={setAllowAnonymous}
            mode={mode}
            onModeChange={setMode}
            maxMessages={maxMessages}
            onMaxMessagesChange={setMaxMessages}
            quickSuggestionsMode={quickSuggestionsMode}
            onQuickSuggestionsModeChange={setQuickSuggestionsMode}
            quickSuggestionsCount={quickSuggestionsCount}
            onQuickSuggestionsCountChange={setQuickSuggestionsCount}
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
                  handoffTargets={handoffTargets}
                  onChange={setHandoffTargets}
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
            sourceUrls={sourceUrls}
            onSourceUrlsChange={setSourceUrls}
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
                  config={notificationConfig}
                  onChange={setNotificationConfig}
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
            googleReviewEnabled={googleReviewEnabled}
            onGoogleReviewEnabledChange={setGoogleReviewEnabled}
            googlePlaceId={googlePlaceId}
            onGooglePlaceIdChange={setGooglePlaceId}
            saving={saving}
            canEdit={canEdit}
          />
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
