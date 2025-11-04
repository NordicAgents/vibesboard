'use client'

import Link from 'next/link'
import { useState } from 'react'
import { type AgentSharePayload, type VibeAgent } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconExternalLink } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'

interface AgentRightbarProps {
  agent: VibeAgent
  share: AgentSharePayload
  className?: string
}

export function AgentRightbar({ agent, share, className }: AgentRightbarProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(share.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // noop
    }
  }

  return (
    <aside className={className} aria-label="Agent details sidebar">
      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Agent</p>
          <h2 className="truncate text-xl font-semibold">{agent.name}</h2>
          <p className="truncate text-xs text-muted-foreground">/a/{agent.agentUrl}</p>
        </div>

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
              <QrCode dataUrl={share.qrDataUrl} size={180} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quick Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Anonymous chat</span>
              <span className="font-medium">{agent.allowAnonymous ? 'Allowed' : 'Restricted'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tools</span>
              <span className="font-medium">{agent.tools.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Files</span>
              <span className="font-medium">{agent.fileKeys.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </aside>
  )
}

