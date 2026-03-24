'use client'

import Script from 'next/script'
import { createContext, useContext, useState, useCallback } from 'react'

interface FacebookSDKContextType {
  isLoaded: boolean
  isLoading: boolean
  error: string | null
}

const FacebookSDKContext = createContext<FacebookSDKContextType>({
  isLoaded: false,
  isLoading: true,
  error: null,
})

export function useFacebookSDK() {
  return useContext(FacebookSDKContext)
}

declare global {
  interface Window {
    fbAsyncInit: () => void
    FB: {
      init: (params: {
        appId: string
        cookie?: boolean
        xfbml?: boolean
        version: string
      }) => void
      login: (
        callback: (response: {
          authResponse?: {
            code?: string
            accessToken?: string
          }
          status: string
        }) => void,
        options: {
          config_id?: string
          response_type?: string
          override_default_response_type?: boolean
          extras?: Record<string, any>
          scope?: string
        }
      ) => void
    }
  }
}

export function FacebookSDKProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleLoad = useCallback(() => {
    const appId = process.env.NEXT_PUBLIC_META_APP_ID
    if (!appId) {
      setError('Meta App ID not configured')
      setIsLoading(false)
      return
    }

    window.fbAsyncInit = () => {
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: 'v21.0',
      })
      setIsLoaded(true)
      setIsLoading(false)
    }

    // If FB is already loaded, call init directly
    if (window.FB) {
      window.fbAsyncInit()
    }
  }, [])

  const handleError = useCallback(() => {
    setError('Failed to load Facebook SDK')
    setIsLoading(false)
  }, [])

  return (
    <FacebookSDKContext.Provider value={{ isLoaded, isLoading, error }}>
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="lazyOnload"
        onLoad={handleLoad}
        onError={handleError}
      />
      {children}
    </FacebookSDKContext.Provider>
  )
}
