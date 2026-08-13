'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  type AgentSharePayload,
  type VibeAgent,
  type VibeAgentConversation,
  type AgentMode,
  type QuickSuggestionsMode
} from '@vibesboard/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { IconExternalLink, IconTrash } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'
import { ToolsFilesManager } from '@/components/agents/tools-files-manager'
import { FeatureGate } from '@/components/tenants/feature-gate-client'
import { AgentHooksSettings } from '@/components/agents/agent-hooks-settings'
import { AgentEmbedSettings } from '@/components/agents/agent-embed-settings'
import { AgentRetrievalSettings } from '@/components/agents/agent-retrieval-settings'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { cn } from '@vibesboard/utils'

interface AgentRightbarProps {
  agent: VibeAgent
  share: AgentSharePayload
  conversations?: VibeAgentConversation[]
  className?: string
  onClose?: () => void
  canEdit: boolean
}

export function AgentRightbar({
  agent,
  share,
  conversations = [],
  className,
  onClose,
  canEdit
}: AgentRightbarProps) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)

  // Form State
  const [name, setName] = useState(agent.name)
  const [domain, setDomain] = useState(agent.domain ?? '')
  const [instructions, setInstructions] = useState(agent.instructions)
  const [greetingText, setGreetingText] = useState(
    agent.greetingText ?? 'Hi How can i help you today'
  )
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
  const [mode, setMode] = useState<AgentMode>(agent.mode || 'provider')
  const [maxResponses, setMaxResponses] = useState<number | null>(
    agent.maxResponses ?? null
  )
  const [maxAgentResponses, setMaxAgentResponses] = useState<number | null>(
    agent.maxAgentResponses ?? null
  )
  const [quickSuggestionsMode, setQuickSuggestionsMode] =
    useState<QuickSuggestionsMode>(agent.quickSuggestionsMode ?? 'off')
  const [quickSuggestionsCount, setQuickSuggestionsCount] = useState<number>(
    agent.quickSuggestionsCount ?? 4
  )
  const [googleReviewEnabled, setGoogleReviewEnabled] = useState(
    agent.googleReviewEnabled ?? false
  )
  const [googlePlaceId, setGooglePlaceId] = useState(agent.googlePlaceId ?? '')
  const [saving, setSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(share.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // noop
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        throw new Error('Failed to delete agent')
      }

      toast.success('Agent deleted')
      router.push('/')
      router.refresh()
    } catch (error) {
      toast.error('Failed to delete agent')
      setIsDeleting(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    const payload: Partial<VibeAgent> = {
      name,
      domain: domain.trim() || null,
      instructions,
      greetingText: greetingText.trim() || null,
      allowAnonymous,
      mode,
      maxResponses,
      maxAgentResponses,
      quickSuggestionsMode,
      quickSuggestionsCount,
      googleReviewEnabled,
      googlePlaceId: googlePlaceId.trim() || null
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
    } catch (_) {
      // keep silent here to avoid toast dep; could add toast if needed
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    name !== agent.name ||
    (domain.trim() || null) !== (agent.domain ?? null) ||
    instructions !== agent.instructions ||
    greetingText.trim() !==
      (agent.greetingText?.trim() ?? 'Hi How can i help you today') ||
    allowAnonymous !== agent.allowAnonymous ||
    mode !== (agent.mode || 'provider') ||
    maxResponses !== (agent.maxResponses ?? null) ||
    maxAgentResponses !== (agent.maxAgentResponses ?? null) ||
    quickSuggestionsMode !== (agent.quickSuggestionsMode ?? 'off') ||
    quickSuggestionsCount !== (agent.quickSuggestionsCount ?? 4) ||
    googleReviewEnabled !== (agent.googleReviewEnabled ?? false) ||
    (googlePlaceId.trim() || null) !== (agent.googlePlaceId ?? null)

  return (
    <aside className={className} aria-label="Agent details sidebar">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Agent</p>
          <h2 className="text-lg font-semibold">{agent.name}</h2>
          {!canEdit && (
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only (ask a tenant admin to edit).
            </p>
          )}
        </div>
      </div>
      <div className="sticky top-0 z-20 mb-4 flex justify-end border-b bg-background/95 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <Button
          onClick={handleSaveAll}
          disabled={saving || !hasChanges || !canEdit}
          className="rounded-full"
          size="sm"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="space-y-5 pb-8">
        {/* Agent card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Input
                value={name}
                disabled={saving || !canEdit}
                onChange={e => setName(e.target.value)}
                placeholder="Agent name"
              />
              <div className="flex items-center justify-between">
                <p className="truncate text-xs text-muted-foreground">
                  /{agent.tenantSlug ?? 'unknown'}/{agent.agentUrl}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Domain</p>
              <Input
                value={domain}
                disabled={saving || !canEdit}
                onChange={e => setDomain(e.target.value)}
                placeholder="e.g. Arcadia Hotel, job openings in TCS"
              />
              <p className="text-xs text-muted-foreground">
                You are only allowed to discuss about this. e.g. &quot;Arcadia
                Hotel&quot;, &quot;job openings in TCS&quot;
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Allow anonymous chat</p>
                <p className="text-xs text-muted-foreground">
                  Require sign-in when disabled.
                </p>
              </div>
              <Switch
                checked={allowAnonymous}
                disabled={saving || !canEdit}
                onCheckedChange={setAllowAnonymous}
              />
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={6}
              placeholder="Explain how the agent should behave, tone, and guardrails."
              disabled={saving || !canEdit}
            />
          </CardContent>
        </Card>

        {/* Greeting */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Greeting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={greetingText}
              onChange={e => setGreetingText(e.target.value)}
              placeholder="Initial greeting message"
              rows={3}
              disabled={saving || !canEdit}
            />
          </CardContent>
        </Card>

        {/* Agent Mode */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agent Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Badge
                variant={mode !== 'collector' ? 'default' : 'secondary'}
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  mode !== 'collector' && 'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setMode('provider')
                }}
              >
                Info Provider
              </Badge>
              <Badge
                variant={mode === 'collector' ? 'default' : 'secondary'}
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  mode === 'collector' && 'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setMode('collector')
                }}
              >
                Info Collector
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === 'collector'
                ? 'Agent will gather information from users'
                : 'Agent will provide information to users'}
            </p>
          </CardContent>
        </Card>

        {/* Response Limits */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Response Limits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Max responses per session
              </label>
              <Input
                type="number"
                min={1}
                max={500}
                value={maxResponses ?? ''}
                onChange={e => {
                  const val = parseInt(e.target.value, 10)
                  setMaxResponses(val > 0 ? val : null)
                }}
                className="mt-1"
                disabled={saving || !canEdit}
                placeholder="Unlimited"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Max AI responses in a single conversation. Leave empty for
                unlimited.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Max responses per agent
              </label>
              <Input
                type="number"
                min={1}
                max={100000}
                value={maxAgentResponses ?? ''}
                onChange={e => {
                  const val = parseInt(e.target.value, 10)
                  setMaxAgentResponses(val > 0 ? val : null)
                }}
                className="mt-1"
                disabled={saving || !canEdit}
                placeholder="Unlimited"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Total AI responses across all sessions. Agent is disabled when
                reached.
              </p>
              {maxAgentResponses != null &&
                agent.totalResponseCount != null && (
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    Used: {agent.totalResponseCount} / {maxAgentResponses}
                  </p>
                )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Suggestions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Suggestions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Badge
                variant={
                  quickSuggestionsMode === 'off' ? 'default' : 'secondary'
                }
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  quickSuggestionsMode === 'off' &&
                    'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setQuickSuggestionsMode('off')
                }}
              >
                Off
              </Badge>
              <Badge
                variant={
                  quickSuggestionsMode === 'smart' ? 'default' : 'secondary'
                }
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  quickSuggestionsMode === 'smart' &&
                    'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setQuickSuggestionsMode('smart')
                }}
              >
                Smart
              </Badge>
              <Badge
                variant={
                  quickSuggestionsMode === 'always' ? 'default' : 'secondary'
                }
                className={cn(
                  'flex-1 cursor-pointer justify-center py-2 transition-all',
                  quickSuggestionsMode === 'always' &&
                    'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setQuickSuggestionsMode('always')
                }}
              >
                Always
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {quickSuggestionsMode === 'off'
                ? 'No suggestions will be shown.'
                : quickSuggestionsMode === 'always'
                  ? 'Suggestions appear after every agent reply.'
                  : 'Suggestions appear when helpful (start + questions).'}
            </p>
            {quickSuggestionsMode !== 'off' && (
              <div className="pt-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Suggestions count
                </label>
                <div className="mt-2">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    disabled={!canEdit}
                    value={quickSuggestionsCount}
                    onChange={e =>
                      setQuickSuggestionsCount(
                        Math.max(1, Math.min(5, parseInt(e.target.value) || 4))
                      )
                    }
                    className="h-9 w-20 text-center"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Google Review */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Google Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Enable Google Review</p>
                <p className="text-xs text-muted-foreground">
                  Show review prompt after chat completion.
                </p>
              </div>
              <Switch
                checked={googleReviewEnabled}
                disabled={saving || !canEdit}
                onCheckedChange={setGoogleReviewEnabled}
              />
            </div>
            {googleReviewEnabled && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Google Place ID
                </label>
                <Input
                  value={googlePlaceId}
                  onChange={e => setGooglePlaceId(e.target.value)}
                  placeholder="Leave empty to use tenant default"
                  disabled={saving || !canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Override the tenant Place ID for this agent.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tools & files */}
        <ToolsFilesManager
          agent={agent}
          onUpdate={() => router.refresh()}
          canEdit={canEdit}
        />

        {/* File Retrieval Strategy */}
        <AgentRetrievalSettings
          agentId={agent.id}
          current={agent.retrievalStrategy ?? 'direct'}
          canEdit={canEdit}
        />

        {/* Share & QR */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Share</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border p-2 text-xs">
              <span className="truncate">{share.url}</span>
              <Button size="sm" variant="secondary" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link
                  href={share.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="sr-only">
                    Open public agent in a new tab
                  </span>
                  <IconExternalLink className="size-4" />
                </Link>
              </Button>
            </div>
            <div className="flex items-center justify-center">
              <QrCode dataUrl={share.qrDataUrl} size={220} />
            </div>
          </CardContent>
        </Card>

        {/* Embed Widget */}
        {agent.tenantId && (
          <FeatureGate feature="EMBED_WIDGET" tenantId={agent.tenantId}>
            <AgentEmbedSettings agent={agent} canEdit={canEdit} />
          </FeatureGate>
        )}

        {/* Hooks */}
        <AgentHooksSettings agentId={agent.id} canEdit={canEdit} />

        {/* Danger Zone */}
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-600 dark:text-red-400">
              Danger Zone
            </CardTitle>
            <CardDescription className="text-red-600/80 dark:text-red-400/80">
              Permanently delete this agent and all its data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="w-full bg-red-600 hover:bg-red-700"
                  disabled={!canEdit}
                >
                  <IconTrash className="mr-2 size-4" />
                  Delete Agent
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. Deleting{' '}
                    <strong>{agent.name}</strong> will permanently remove:
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      <li>The agent and its configuration</li>
                      <li>All uploaded files</li>
                      <li>All conversations and message history</li>
                      <li>All bookings and scheduling data</li>
                    </ul>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={e => {
                      e.preventDefault()
                      handleDelete()
                    }}
                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                    disabled={isDeleting || !canEdit}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete Agent'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </aside>
  )
}
