'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  type AgentSharePayload,
  type VibeAgent,
  type VibeAgentConversation
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { IconClose, IconExternalLink } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'
import { formatDate } from '@/lib/utils'

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
  const [name, setName] = useState(agent.name)
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
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

  const updateAgent = async (payload: Partial<VibeAgent>) => {
    setSaving(true)
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

  const topConversations = useMemo(
    () => conversations.slice(0, 10),
    [conversations]
  )

  return (
    <aside className={className} aria-label="Agent details sidebar">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Agent</p>
          <h2 className="text-lg font-semibold">{agent.name}</h2>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <IconClose className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="space-y-5">
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
                <Button
                  size="sm"
                  onClick={() => updateAgent({ name })}
                  disabled={saving || name.trim().length === 0 || name === agent.name}
                >
                  Save
                </Button>
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
                onCheckedChange={value => {
                  setAllowAnonymous(value)
                  updateAgent({ allowAnonymous: value })
                }}
              />
            </div>
          </CardContent>
        </Card>

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
                <Link href={share.url} target="_blank" rel="noopener noreferrer">
                  <IconExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex items-center justify-center">
              <QrCode dataUrl={share.qrDataUrl} size={220} />
            </div>
          </CardContent>
        </Card>

        {/* Conversations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topConversations.length ? (
              <div className="space-y-2">
                {topConversations.map(c => (
                  <div
                    key={c.id}
                    className="rounded-md border p-2 text-sm transition hover:border-primary"
                  >
                    <div className="line-clamp-1 font-medium">
                      {c.summary || c.messages.at(-1)?.content || 'Conversation'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Updated {formatDate(c.updatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No conversations yet.</p>
            )}
            <div className="flex items-center justify-between pt-1">
              <Button asChild size="sm">
                <Link href={`/agents/${agent.id}/conversations/new`}>Start chat</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/agents/${agent.id}/conversations`}>View all</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </aside>
  )
}
