'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Key } from 'lucide-react'
import toast from 'react-hot-toast'

interface ConnectApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ConnectApiKeyDialog({
  open,
  onOpenChange,
  onSuccess,
}: ConnectApiKeyDialogProps) {
  const [accessToken, setAccessToken] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          wabaId: wabaId.trim(),
        }),
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect via API Key</DialogTitle>
          <DialogDescription>
            Paste your System User access token and WhatsApp Business Account ID
            from Meta Business Suite.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="123456789012345"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              disabled={connecting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="access-token">System User Access Token</Label>
            <Input
              id="access-token"
              type="password"
              placeholder="EAABsbCS..."
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={connecting}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

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
