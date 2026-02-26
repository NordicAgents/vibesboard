'use client'

import * as React from 'react'
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'

import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/components/ui/button'
import { IconSpinner } from '@/components/ui/icons'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

interface GoogleLoginButtonProps extends ButtonProps {
  text?: string
  redirectedFrom?: string
}

const googleProvider = new GoogleAuthProvider()

export function GoogleLoginButton({
  text = 'Login with Google',
  redirectedFrom,
  className,
  ...props
}: GoogleLoginButtonProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const router = useRouter()
  const auth = getClientAuth()

  if (process.env.NEXT_PUBLIC_AUTH_GOOGLE !== 'true') {
    return null
  }

  return (
    <Button
      variant="outline"
      onClick={async () => {
        setIsLoading(true)
        try {
          const result = await signInWithPopup(auth, googleProvider)
          const idToken = await result.user.getIdToken()

          const res = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
          })

          if (!res.ok) {
            toast.error('Failed to create session. Please try again.')
            return
          }

          router.push(redirectedFrom ?? '/')
          router.refresh()
        } catch (err: any) {
          if (err?.code !== 'auth/popup-closed-by-user') {
            toast.error(err?.message ?? 'Google sign-in failed.')
          }
        } finally {
          setIsLoading(false)
        }
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
