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
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react'
import toast from 'react-hot-toast'

interface ConnectByoaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const SETUP_STEPS = [
  {
    title: 'Create a Meta App',
    description:
      'Go to the Meta Developer Portal and create a new app. Select "Business" as the app type.',
    link: 'https://developers.facebook.com/apps/create/',
    linkLabel: 'Create Meta App'
  },
  {
    title: 'Add Instagram product',
    description:
      'In your app dashboard, click "Add Products" and add the Instagram product. Complete the App Review for instagram_manage_messages permission.'
  },
  {
    title: 'Copy App ID and App Secret',
    description:
      'Go to App Settings > Basic. Copy the App ID and App Secret from there.',
    link: 'https://developers.facebook.com/apps/',
    linkLabel: 'Open App Settings'
  },
  {
    title: 'Create a System User and generate token',
    description:
      'In Meta Business Settings > System Users, create an Admin system user. Assign your app, page, and Instagram permissions. Generate a token with pages_manage_metadata, instagram_basic, and instagram_manage_messages scopes. Set expiry to "Never".',
    link: 'https://business.facebook.com/settings/system-users',
    linkLabel: 'Open System Users'
  },
  {
    title: 'Find your Facebook Page ID',
    description:
      'In Business Settings > Pages, select the page linked to your Instagram account. The numeric Page ID is shown at the top.'
  },
  {
    title: 'Configure webhook (after connecting)',
    description:
      'After connecting below, you\'ll receive a webhook URL. Configure it in your Meta App Dashboard under Instagram > Webhooks, using the Verify Token you enter below. Subscribe to the "messages" field.'
  }
]

function generateRandomToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export function ConnectByoaDialog({
  open,
  onOpenChange,
  onSuccess
}: ConnectByoaDialogProps) {
  const [metaAppId, setMetaAppId] = useState('')
  const [metaAppSecret, setMetaAppSecret] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [pageId, setPageId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)

  const resetForm = () => {
    setMetaAppId('')
    setMetaAppSecret('')
    setAccessToken('')
    setWebhookVerifyToken('')
    setPageId('')
    setError(null)
    setWebhookUrl(null)
    setCopied(false)
    setCopiedToken(false)
  }

  const handleCopyToken = async () => {
    if (!webhookVerifyToken) return
    await navigator.clipboard.writeText(webhookVerifyToken)
    setCopiedToken(true)
    toast.success('Verify token copied!')
    setTimeout(() => setCopiedToken(false), 2000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (
      !metaAppId.trim() ||
      !metaAppSecret.trim() ||
      !accessToken.trim() ||
      !webhookVerifyToken.trim() ||
      !pageId.trim()
    ) {
      setError('All fields are required')
      return
    }

    if (!/^\d+$/.test(metaAppId.trim())) {
      setError('Meta App ID must be a numeric string')
      return
    }

    if (!/^\d+$/.test(pageId.trim())) {
      setError('Page ID must be a numeric string')
      return
    }

    setConnecting(true)
    try {
      const res = await fetch('/api/instagram-inbox/auth/byoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaAppId: metaAppId.trim(),
          metaAppSecret: metaAppSecret.trim(),
          accessToken: accessToken.trim(),
          webhookVerifyToken: webhookVerifyToken.trim(),
          pageId: pageId.trim()
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to connect account')
      }

      const data = await res.json()
      setWebhookUrl(data.byoaWebhookUrl)
      toast.success('Instagram account connected via BYOA!')
      onSuccess?.()
    } catch (err: any) {
      setError(err.message || 'Failed to connect account')
    } finally {
      setConnecting(false)
    }
  }

  const handleCopyUrl = async () => {
    if (!webhookUrl) return
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    toast.success('Webhook URL copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = (open: boolean) => {
    if (!open) resetForm()
    onOpenChange(open)
  }

  // Show success state with webhook URL
  if (webhookUrl) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Account Connected</DialogTitle>
            <DialogDescription>
              Configure the webhook URL below in your Meta App Dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyUrl}
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Verify Token</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={webhookVerifyToken}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyToken}
                >
                  {copiedToken ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-bg-hover/50 p-3 text-sm text-text-secondary space-y-2">
              <p className="font-medium text-text-primary">Next steps:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Open your Meta App Dashboard</li>
                <li>Go to Instagram &gt; Webhooks</li>
                <li>Paste the webhook URL above</li>
                <li>Enter the Verify Token above</li>
                <li>Subscribe to the &quot;messages&quot; field</li>
              </ol>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect via BYOA</DialogTitle>
          <DialogDescription>
            Bring your own Meta App to connect Instagram. You manage the app,
            App Review, and webhook configuration.
          </DialogDescription>
        </DialogHeader>

        <div>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-bg-hover/50 px-3 py-2 text-left text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors"
          >
            <span>How do I set this up?</span>
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
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-orange/10 text-xs font-semibold text-accent-orange">
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
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ig-byoa-app-id">Meta App ID</Label>
            <Input
              id="ig-byoa-app-id"
              placeholder="123456789012345"
              value={metaAppId}
              onChange={e => setMetaAppId(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Found in App Settings &gt; Basic in the Meta Developer Portal
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-byoa-app-secret">Meta App Secret</Label>
            <Input
              id="ig-byoa-app-secret"
              type="password"
              placeholder="abc123def456..."
              value={metaAppSecret}
              onChange={e => setMetaAppSecret(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Found in App Settings &gt; Basic (click &quot;Show&quot;)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-byoa-token">Page Access Token</Label>
            <Input
              id="ig-byoa-token"
              type="password"
              placeholder="EAABsbCS..."
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Generated from System Users with pages_manage_metadata,
              instagram_basic, and instagram_manage_messages permissions
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ig-byoa-verify-token">Webhook Verify Token</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-0.5 text-xs"
                onClick={() => setWebhookVerifyToken(generateRandomToken())}
                disabled={connecting}
              >
                Generate Random
              </Button>
            </div>
            <Input
              id="ig-byoa-verify-token"
              placeholder="my-custom-verify-token"
              value={webhookVerifyToken}
              onChange={e => setWebhookVerifyToken(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              You&apos;ll enter this same token in your Meta App&apos;s webhook
              configuration
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ig-byoa-page-id">Facebook Page ID</Label>
            <Input
              id="ig-byoa-page-id"
              placeholder="123456789012345"
              value={pageId}
              onChange={e => setPageId(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Found in Business Settings &gt; Pages (the page linked to your
              Instagram account)
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={connecting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connecting}>
              {connecting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Building2 className="mr-2 size-4" />
              )}
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
