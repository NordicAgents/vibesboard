'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  type AgentSharePayload,
  type VibeAgent,
  type VibeAgentConversation
} from '@/lib/types'
import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'
import { getBrowserSupabaseClient } from '@/lib/supabase/browser-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
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
  const [instructions, setInstructions] = useState(agent.instructions)
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
  const [fileKeys, setFileKeys] = useState<string[]>(agent.fileKeys)
  const [selectedTools, setSelectedTools] = useState<
    Array<import('@/lib/types').AgentToolType>
  >(() => agent.tools.map(t => t.type))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

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

  const toolOptions = useMemo(
    () => Object.values(BUILTIN_AGENT_TOOLS),
    []
  )

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    const supabase = getBrowserSupabaseClient()
    try {
      const uploads = await Promise.all(
        Array.from(files).map(async file => {
          const path = `${agent.userId}/${Date.now()}-${file.name}`
          const { data, error } = await supabase.storage
            .from('agent-files')
            .upload(path, file, { upsert: true })
          if (error || !data) throw error ?? new Error('Upload failed')
          return data.path
        })
      )
      const next = Array.from(new Set([...fileKeys, ...uploads]))
      setFileKeys(next)
      await updateAgent({ fileKeys: next })
    } catch (_) {
      // silent fail
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveFile = async (path: string) => {
    const supabase = getBrowserSupabaseClient()
    try {
      await supabase.storage.from('agent-files').remove([path])
    } catch (_) {
      // ignore removal failures
    }
    const next = fileKeys.filter(item => item !== path)
    setFileKeys(next)
    await updateAgent({ fileKeys: next })
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
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => updateAgent({ instructions })}
                disabled={
                  saving ||
                  instructions.trim().length < 10 ||
                  instructions === agent.instructions
                }
              >
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tools & files */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tools & files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Tools</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {toolOptions.map(tool => {
                  const checked = selectedTools.includes(tool.id as any)
                  return (
                    <Badge
                      key={tool.id}
                      variant={checked ? 'default' : 'secondary'}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedTools(prev =>
                          checked
                            ? prev.filter(item => item !== (tool.id as any))
                            : [...prev, tool.id as any]
                        )
                      }}
                    >
                      {tool.name}
                    </Badge>
                  )
                })}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={() =>
                    updateAgent({
                      tools: selectedTools.map(t => ({
                        ...(BUILTIN_AGENT_TOOLS[t as keyof typeof BUILTIN_AGENT_TOOLS] ??
                          { name: t }),
                        id: t,
                        type: t
                      }))
                    })
                  }
                  disabled={saving}
                >
                  Save tools
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Reference files</label>
              <input
                type="file"
                multiple
                onChange={e => handleUpload(e.target.files)}
                disabled={uploading || saving}
                className="block w-full text-sm"
              />
              {fileKeys.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Upload transcripts, docs, or FAQs to ground responses.
                </p>
              )}
              {fileKeys.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {fileKeys.map(key => (
                    <li
                      key={key}
                      className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="truncate">{key}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveFile(key)}
                        disabled={saving}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
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
