'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFacebookSDK } from '@/components/whatsapp-inbox/facebook-sdk-provider'
import { Instagram, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface ConnectInstagramButtonProps {
  tenantId: string
  onSuccess?: () => void
}

export function ConnectInstagramButton({
  tenantId,
  onSuccess
}: ConnectInstagramButtonProps) {
  const { isLoaded, isLoading: sdkLoading, error: sdkError } = useFacebookSDK()
  const [connecting, setConnecting] = useState(false)

  const handleConnect = () => {
    if (!isLoaded || !window.FB) {
      toast.error('Facebook SDK not loaded. Please refresh the page.')
      return
    }

    const configId = process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID
    if (!configId) {
      toast.error('Instagram Login configuration not set up.')
      return
    }

    setConnecting(true)

    window.FB.login(
      response => {
        if (response.authResponse?.code) {
          fetch('/api/instagram-inbox/auth/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: response.authResponse.code })
          })
            .then(res => {
              if (!res.ok) {
                return res.json().then(data => {
                  throw new Error(data.error || 'Failed to connect account')
                })
              }
              toast.success('Instagram account connected!')
              onSuccess?.()
            })
            .catch((err: any) => {
              toast.error(err.message || 'Failed to connect account')
            })
            .finally(() => setConnecting(false))
        } else {
          // User cancelled or denied
          if (response.status === 'not_authorized') {
            toast.error('Permission denied. Please allow access to connect.')
          }
          setConnecting(false)
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: 2
        }
      }
    )
  }

  if (sdkError) {
    return (
      <Button disabled variant="outline">
        <Instagram className="mr-2 size-4" />
        SDK Error
      </Button>
    )
  }

  return (
    <Button onClick={handleConnect} disabled={!isLoaded || connecting}>
      {connecting || sdkLoading ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <Instagram className="mr-2 size-4" />
      )}
      {connecting
        ? 'Connecting...'
        : sdkLoading
          ? 'Loading...'
          : 'Connect Instagram'}
    </Button>
  )
}
