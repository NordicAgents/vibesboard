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
  canEdit: boolean
}

export function AgentDashboard({ agent, share, canEdit }: AgentDashboardProps) {
  const router = useRouter()
  const [allowAnonymous, setAllowAnonymous] = useState(agent.allowAnonymous)
  const [isSaving, setIsSaving] = useState(false)

  const updateAgent = async (payload: Partial<VibeAgent>) => {
    if (!canEdit) {
      toast.error('Read-only: you do not have permission to edit this agent')
      return
    }
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
    <div className="space-y-6 bg-beige-bg p-6 md:p-8 dark:bg-background">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-switzer text-sm uppercase tracking-wider text-gray-secondary">
            Agent
          </p>
          <h1 className="font-switzer text-3xl font-bold text-black-primary dark:text-foreground">
            {agent.name}
          </h1>
        </div>
        <div className="flex gap-3">
          <Button asChild className="rounded-full font-switzer">
            <Link href={`/agents/${agent.id}`}>Start chat</Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-black-10 bg-purewhite-bg shadow-lg">
          <CardHeader>
            <CardTitle className="font-switzer text-2xl font-bold text-black-primary">
              Shareable link
            </CardTitle>
            <CardDescription className="font-switzer text-gray-secondary">
              Send people to this agent via URL or QR.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-2xl border border-black-10 bg-beige-bg/30 p-3 text-sm">
              <span className="truncate font-switzer text-black-primary">
                {share.url}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCopyLink}
                className="rounded-full font-switzer"
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                asChild
                className="rounded-full"
              >
                <Link href={share.url} target="_blank">
                  <IconExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-black-10 bg-beige-bg/30 p-4">
              <div>
                <p className="font-switzer text-sm font-medium text-black-primary">
                  Allow anonymous chat
                </p>
                <p className="font-switzer text-xs text-gray-secondary">
                  Toggle to require sign in for public chats.
                </p>
              </div>
              <Switch
                checked={allowAnonymous}
                disabled={isSaving || !canEdit}
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
      <Card className="rounded-3xl border-black-10 bg-purewhite-bg shadow-lg">
        <CardHeader>
          <CardTitle className="font-switzer text-2xl font-bold text-black-primary">
            Instructions
          </CardTitle>
          <CardDescription className="font-switzer text-gray-secondary">
            What the assistant follows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-2xl bg-beige-bg/30 p-4 font-switzer text-sm text-black-primary">
            {agent.instructions}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
