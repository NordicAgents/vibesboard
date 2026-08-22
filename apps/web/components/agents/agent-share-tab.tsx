'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AgentSharePayload, VibeAgent } from '@vibesboard/contracts'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { IconExternalLink, IconTrash } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'
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

interface AgentShareTabProps {
  agent: VibeAgent
  share: AgentSharePayload
  canEdit: boolean
  isDeleting: boolean
  onDelete: () => void
}

export function AgentShareTab({
  agent,
  share,
  canEdit,
  isDeleting,
  onDelete
}: AgentShareTabProps) {
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
    <div className="space-y-5 pb-8">
      {/* Share & QR */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Share Link</CardTitle>
          <CardDescription>
            Share this link to let people chat with your agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border p-2 text-xs">
            <span className="truncate">{share.url}</span>
            <Button size="sm" variant="secondary" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href={share.url} target="_blank" rel="noopener noreferrer">
                <span className="sr-only">Open public agent in a new tab</span>
                <IconExternalLink className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="flex items-center justify-center">
            <QrCode dataUrl={share.qrDataUrl} size={220} />
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      {canEdit && (
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
                    This action cannot be undone. This will permanently delete
                    your agent &quot;{agent.name}&quot; and remove all
                    associated data including files and conversations.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={e => {
                      e.preventDefault()
                      onDelete()
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
      )}
    </div>
  )
}
