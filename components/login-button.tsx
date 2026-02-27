'use client'

import * as React from 'react'
import { signInWithPopup, GithubAuthProvider } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'

import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/components/ui/button'
import { IconGitHub, IconSpinner } from '@/components/ui/icons'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

interface LoginButtonProps extends ButtonProps {
  showGithubIcon?: boolean
  text?: string
  redirectedFrom?: string
}

const githubProvider = new GithubAuthProvider()

export function LoginButton({
  text = 'Continue with GitHub',
  showGithubIcon = true,
  redirectedFrom,
  className,
  ...props
}: LoginButtonProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const router = useRouter()
  const auth = getClientAuth()

  if (process.env.NEXT_PUBLIC_AUTH_GITHUB !== 'true') {
    return null
  }

  return (
    <Button
      variant="outline"
      onClick={async () => {
        setIsLoading(true)
        try {
          const result = await signInWithPopup(auth, githubProvider)
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
            toast.error(err?.message ?? 'GitHub sign-in failed.')
          }
        } finally {
          setIsLoading(false)
        }
      }}
      disabled={isLoading}
      className={cn(
        'w-full gap-2 border-[#E2DDD4] text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:border-[#2E2B25] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]',
        className
      )}
      {...props}
    >
      {isLoading ? (
        <IconSpinner className="mr-2 animate-spin" />
      ) : showGithubIcon ? (
        <IconGitHub className="mr-2" />
      ) : null}
      {text}
    </Button>
  )
}
