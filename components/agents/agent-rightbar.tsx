'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  type AgentSharePayload,
  type VibeAgent,
  type VibeAgentConversation,
  type AgentMode
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { IconExternalLink } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'
import { ToolsFilesManager } from '@/components/agents/tools-files-manager'
import { cn } from '@/lib/utils'

interface AgentRightbarProps {
  agent: VibeAgent
  share: AgentSharePayload
  conversations?: VibeAgentConversation[]
  className?: string
  onClose?: () => void
}

export function AgentRightbar({
  agent,
  share,
  conversations = [],
  className,
  onClose
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
  const [saving, setSaving] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(share.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // noop
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
      maxMessages
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
    maxMessages !== (agent.maxMessages ?? null)

  return (
    <aside className={className} aria-label="Agent details sidebar">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Agent</p>
          <h2 className="text-lg font-semibold">{agent.name}</h2>
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
                disabled={saving}
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
                disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
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
                  mode !== 'collector' && 'bg-primary text-primary-foreground'
                )}
                onClick={() => {
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
                  mode === 'collector' && 'bg-primary text-primary-foreground'
                )}
                onClick={() => {
                  setMode('collector')
                  setMaxMessages(5)
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
                  value={maxMessages ?? 5}
                  onChange={e =>
                    setMaxMessages(parseInt(e.target.value, 10) || 5)
                  }
                  className="mt-1"
                  disabled={saving}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tools & files */}
        <ToolsFilesManager agent={agent} onUpdate={() => router.refresh()} />

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
      </div>

      {/* Floating Save Button */}
      <div className="fixed bottom-6 left-0 right-0 z-20 flex justify-center pointer-events-none lg:left-[300px]">
        <div className="mx-auto flex items-center gap-2 rounded-full border bg-background p-2 shadow-lg pointer-events-auto">
          <Button
            onClick={handleSaveAll}
            disabled={saving || !hasChanges}
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
