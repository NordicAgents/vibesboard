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
} from '@/lib/types'
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
import { AgentWhatsAppSettings } from '@/components/agents/agent-whatsapp-settings'
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
import { cn } from '@/lib/utils'

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
  const [quickSuggestionsCount, setQuickSuggestionsCount] = useState<3 | 4>(
    agent.quickSuggestionsCount === 3 ? 3 : 4
  )
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
      instructions,
      greetingText: greetingText.trim() || null,
      allowAnonymous,
      mode,
      maxMessages,
      quickSuggestionsMode,
      quickSuggestionsCount
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
    instructions !== agent.instructions ||
    greetingText.trim() !==
      (agent.greetingText?.trim() ?? 'Hi How can i help you today') ||
    allowAnonymous !== agent.allowAnonymous ||
    mode !== (agent.mode || 'provider') ||
    maxMessages !== (agent.maxMessages ?? null) ||
    quickSuggestionsMode !== (agent.quickSuggestionsMode ?? 'off') ||
    quickSuggestionsCount !== (agent.quickSuggestionsCount === 3 ? 3 : 4)

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
      <div className="space-y-5 pb-20">
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
                  /a/{agent.agentUrl}
                </p>
              </div>
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
            <Input
              value={greetingText}
              onChange={e => setGreetingText(e.target.value)}
              placeholder="Initial greeting message"
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
                  'cursor-pointer transition-all flex-1 justify-center py-2',
                  mode !== 'collector' && 'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setMode('provider')
                  setMaxMessages(null)
                }}
              >
                Info Provider
              </Badge>
              <Badge
                variant={mode === 'collector' ? 'default' : 'secondary'}
                className={cn(
                  'cursor-pointer transition-all flex-1 justify-center py-2',
                  mode === 'collector' && 'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setMode('collector')
                  setMaxMessages(20)
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
            {mode === 'collector' && (
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Max messages before completion
                </label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={maxMessages ?? 20}
                  onChange={e =>
                    setMaxMessages(parseInt(e.target.value, 10) || 20)
                  }
                  className="mt-1"
                  disabled={saving || !canEdit}
                />
              </div>
            )}
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
                variant={quickSuggestionsMode === 'off' ? 'default' : 'secondary'}
                className={cn(
                  'cursor-pointer transition-all flex-1 justify-center py-2',
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
                  'cursor-pointer transition-all flex-1 justify-center py-2',
                  quickSuggestionsMode === 'smart' &&
                    'bg-primary text-primary-foreground',
                  !canEdit && 'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canEdit) return
                  setQuickSuggestionsMode('smart')
                }}
              >
                Smart (Wisely)
              </Badge>
              <Badge
                variant={
                  quickSuggestionsMode === 'always' ? 'default' : 'secondary'
                }
                className={cn(
                  'cursor-pointer transition-all flex-1 justify-center py-2',
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
                <div className="mt-2 flex gap-2">
                  <Badge
                    variant={
                      quickSuggestionsCount === 3 ? 'default' : 'secondary'
                    }
                    className={cn(
                      'cursor-pointer transition-all px-4 py-1',
                      quickSuggestionsCount === 3 &&
                        'bg-primary text-primary-foreground',
                      !canEdit && 'cursor-not-allowed opacity-60'
                    )}
                    onClick={() => {
                      if (!canEdit) return
                      setQuickSuggestionsCount(3)
                    }}
                  >
                    3
                  </Badge>
                  <Badge
                    variant={
                      quickSuggestionsCount === 4 ? 'default' : 'secondary'
                    }
                    className={cn(
                      'cursor-pointer transition-all px-4 py-1',
                      quickSuggestionsCount === 4 &&
                        'bg-primary text-primary-foreground',
                      !canEdit && 'cursor-not-allowed opacity-60'
                    )}
                    onClick={() => {
                      if (!canEdit) return
                      setQuickSuggestionsCount(4)
                    }}
                  >
                    4
                  </Badge>
                </div>
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
                  <IconExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex items-center justify-center">
              <QrCode dataUrl={share.qrDataUrl} size={220} />
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Integration */}
        <AgentWhatsAppSettings agentId={agent.id} canEdit={canEdit} />

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
                  <IconTrash className="mr-2 h-4 w-4" />
                  Delete Agent
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    your agent "{agent.name}" and remove all associated data
                    including files and conversations.
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

      {/* Floating Save Button */}
      <div className="fixed bottom-6 left-0 right-0 z-20 flex justify-center pointer-events-none lg:left-[300px]">
        <div className="mx-auto flex items-center gap-2 rounded-full border bg-background p-2 shadow-lg pointer-events-auto">
          <Button
            onClick={handleSaveAll}
            disabled={saving || !hasChanges || !canEdit}
            className="w-full md:w-auto rounded-full"
            size="sm"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </aside>
  )
}
