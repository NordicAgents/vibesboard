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
    title: 'Open Meta Business Suite',
    description:
      'Go to your Meta Business Settings and select your business account.',
    link: 'https://business.facebook.com/settings',
    linkLabel: 'Open Business Settings'
  },
  {
    title: 'Find your WABA ID',
    description:
      'In Business Settings, go to Accounts > WhatsApp Accounts. Select your account — the WABA ID is the numeric ID shown at the top of the page.'
  },
  {
    title: 'Create a System User',
    description:
      'Go to Users > System Users. Click "Add" to create a new System User (choose "Admin" role). If you already have one, you can reuse it.',
    link: 'https://business.facebook.com/settings/system-users',
    linkLabel: 'Open System Users'
  },
  {
    title: 'Assign WhatsApp permissions',
    description:
      'Click "Add Assets" on your System User. Select "Apps", find your Meta app, and enable "Manage app". Then select "WhatsApp Accounts", pick your WABA, and enable "Manage WhatsApp business account".'
  },
  {
    title: 'Generate access token',
    description:
      'Click "Generate New Token" on the System User. Select your app and check these permissions: whatsapp_business_management, whatsapp_business_messaging. Set token expiry to "Never" for uninterrupted service. Copy the token.'
  }
]

export function ConnectApiKeyDialog({
  open,
  onOpenChange,
  onSuccess
}: ConnectApiKeyDialogProps) {
  const [accessToken, setAccessToken] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!accessToken.trim() || !wabaId.trim()) {
      setError('Both fields are required')
      return
    }

    if (!/^\d+$/.test(wabaId.trim())) {
      setError('WABA ID must be a numeric string (e.g. "123456789012345")')
      return
    }

    setConnecting(true)
    try {
      const res = await fetch('/api/whatsapp-inbox/auth/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          wabaId: wabaId.trim()
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to connect account')
      }

      toast.success('WhatsApp Business Account connected!')
      setAccessToken('')
      setWabaId('')
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
            Connect your WhatsApp Business Account using a System User token
            from Meta Business Suite.
          </DialogDescription>
        </DialogHeader>

        <div>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-bg-hover/50 px-3 py-2 text-left text-sm font-medium text-text-primary hover:bg-bg-hover transition-colors"
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
              <div className="border-t border-border pt-2">
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
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
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="123456789012345"
              value={wabaId}
              onChange={e => setWabaId(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Found in Business Settings &gt; WhatsApp Accounts
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="access-token">System User Access Token</Label>
            <Input
              id="access-token"
              type="password"
              placeholder="EAABsbCS..."
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              disabled={connecting}
            />
            <p className="text-xs text-text-tertiary">
              Generated from System Users page with whatsapp_business_management
              and whatsapp_business_messaging permissions
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
