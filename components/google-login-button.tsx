'use client'

import * as React from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/components/ui/button'
import { IconSpinner } from '@/components/ui/icons'

interface GoogleLoginButtonProps extends ButtonProps {
  text?: string
  redirectedFrom?: string
}

export function GoogleLoginButton({
  text = 'Login with Google',
  redirectedFrom,
  className,
  ...props
}: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  // Create a Supabase client configured to use cookies
  const supabase = createClientComponentClient()

  if (process.env.NEXT_PUBLIC_AUTH_GOOGLE !== 'true') {
    return null
  }

  return (
    <Button
      variant="outline"
      onClick={async () => {
        setIsLoading(true)
        const redirectTo = redirectedFrom
          ? `${location.origin}/api/auth/callback?redirectedFrom=${encodeURIComponent(redirectedFrom)}`
          : `${location.origin}/api/auth/callback`
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo }
        })
      }}
      disabled={isLoading}
      className={cn(className)}
      {...props}
    >
      {isLoading ? <IconSpinner className="mr-2 animate-spin" /> : null}
      {text}
    </Button>
  )
}
