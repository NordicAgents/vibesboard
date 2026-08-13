'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2,
  Key,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from 'lucide-react'
import toast from 'react-hot-toast'

interface ConnectApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const SETUP_STEPS = [
  {
    title: 'Link Instagram to a Facebook Page',
    description:
      'Your Instagram account must be a Business or Creator account linked to a Facebook Page. In Instagram, go to Settings > Account > Linked Accounts > Facebook and connect your Page.'
  },
  {
    title: 'Open Meta Business Settings',
    description:
      'Go to Meta Business Settings and select the business that owns your Facebook Page.',
    link: 'https://business.facebook.com/settings',
    linkLabel: 'Open Business Settings'
  },
  {
    title: 'Find your Facebook Page ID',
    description:
      'In Business Settings, go to Accounts > Pages. Select your Page — the Page ID is the numeric ID shown at the top of the page details panel.'
  },
  {
    title: 'Create a System User',
    description:
      'Go to Users > System Users. Click "Add" to create a new System User (choose "Admin" role). If you already have one, you can reuse it.',
    link: 'https://business.facebook.com/settings/system-users',
    linkLabel: 'Open System Users'
  },
  {
    title: 'Assign Page & Instagram permissions',
    description:
      'Click "Add Assets" on your System User. Select "Pages", pick your Page, and enable "Manage Page". Then select "Instagram Accounts", pick your Instagram account, and enable "Manage Instagram account".'
  },
  {
    title: 'Generate Page Access Token',
    description:
      'Click "Generate New Token" on the System User. Select your app and check these permissions: pages_manage_metadata, instagram_basic, instagram_manage_messages. Set token expiry to "Never". Copy the token.'
  }
]

export function ConnectApiKeyDialog({
  open,
  onOpenChange,
  onSuccess
}: ConnectApiKeyDialogProps) {
  const [accessToken, setAccessToken] = useState('')
  const [pageId, setPageId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!accessToken.trim() || !pageId.trim()) {
      setError('Both fields are required')
      return
    }

    if (!/^\d+$/.test(pageId.trim())) {
      setError('Page ID must be a numeric string (e.g. "123456789012345")')
      return
    }

    setConnecting(true)
    try {
      const res = await fetch('/api/instagram-inbox/auth/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          pageId: pageId.trim()
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to connect account')
      }

      toast.success('Instagram account connected!')
      setAccessToken('')
      setPageId('')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      setError(err.message || 'Failed to connect account')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect via API Key</DialogTitle>
          <DialogDescription>
            Connect your Instagram Business account using a Page Access Token
            from Meta Business Suite.
          </DialogDescription>
        </DialogHeader>

        <div>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="bg-bg-hover/50 flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm font-medium text-text-primary transition-colors hover:bg-bg-hover"
          >
            <span>How do I get these values?</span>
            {showGuide ? (
              <ChevronUp className="size-4 text-text-secondary" />
            ) : (
              <ChevronDown className="size-4 text-text-secondary" />
            )}
          </button>

          {showGuide && (
            <div className="mt-2 space-y-3 rounded-lg border border-border bg-bg-surface p-3">
              <ol className="space-y-3">
                {SETUP_STEPS.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="bg-accent-orange/10 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-accent-orange">
                      {i + 1}
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-text-primary">
                        {step.title}
                      </p>
                      <p className="text-xs leading-relaxed text-text-secondary">
                        {step.description}
                      </p>
                      {step.link && (
                        <a
                          href={step.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-accent-orange hover:underline"
                        >
                          {step.linkLabel}
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="border-t border-border pt-2">
                <a
                  href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-accent-orange"
                >
                  Full Meta documentation
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="page-id">Facebook Page ID</Label>
            <Input
              id="page-id"
              placeholder="123456789012345"
              value={pageId}
              onChange={e => setPageId(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Found in Business Settings &gt; Accounts &gt; Pages
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="access-token">Page Access Token</Label>
            <Input
              id="access-token"
              type="password"
              placeholder="EAABsbCS..."
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Generated from System Users page with pages_manage_metadata,
              instagram_basic, and instagram_manage_messages permissions
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={connecting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connecting}>
              {connecting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Key className="mr-2 size-4" />
              )}
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
