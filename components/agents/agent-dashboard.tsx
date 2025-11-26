'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

import { type AgentSharePayload, type VibeAgent } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { IconExternalLink } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'
import { ToolsFilesDisplay } from '@/components/agents/tools-files-display'

interface AgentDashboardProps {
  agent: VibeAgent
  share: AgentSharePayload
}

export function AgentDashboard({ agent, share }: AgentDashboardProps) {
  const router = useRouter()
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
  const [isSaving, setIsSaving] = useState(false)

  const updateAgent = async (payload: Partial<VibeAgent>) => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error ?? 'Failed to update agent')
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyLink = async () => {
    await navigator.clipboard?.writeText(share.url)
    toast.success('Share URL copied')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase text-muted-foreground">Agent</p>
          <h1 className="text-3xl font-semibold">{agent.name}</h1>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="secondary">
            <Link href={`/agents/${agent.id}/conversations`}>
              View conversations
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/agents/${agent.id}/conversations/new`}>
              Start chat
            </Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Shareable link</CardTitle>
            <CardDescription>Send people to this agent via URL or QR.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <span className="truncate">{share.url}</span>
              <Button size="sm" variant="secondary" onClick={handleCopyLink}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href={share.url} target="_blank">
                  <IconExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Allow anonymous chat</p>
                <p className="text-xs text-muted-foreground">
                  Toggle to require sign in for public chats.
                </p>
              </div>
              <Switch
                checked={allowAnonymous}
                disabled={isSaving}
                onCheckedChange={value => {
                  setAllowAnonymous(value)
                  updateAgent({ allowAnonymous: value })
                }}
              />
            </div>
            <div className="flex items-center justify-center">
              <QrCode dataUrl={share.qrDataUrl} size={200} />
            </div>
          </CardContent>
        </Card>
        <ToolsFilesDisplay agent={agent} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
          <CardDescription>What the assistant follows.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-4 text-sm">
            {agent.instructions}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
