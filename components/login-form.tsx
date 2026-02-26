'use client'

import * as React from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'

import { Button } from '@/components/ui/button'
import { IconSpinner } from '@/components/ui/icons'
import { Input } from './ui/input'
import { Label } from './ui/label'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'

interface LoginFormProps extends React.ComponentPropsWithoutRef<'div'> {
  action: 'sign-in' | 'sign-up'
  redirectedFrom?: string
}

async function postSessionCookie(idToken: string): Promise<boolean> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  })
  return res.ok
}

export function LoginForm({
  className,
  action = 'sign-in',
  redirectedFrom,
  ...props
}: LoginFormProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const router = useRouter()
  const auth = getClientAuth()

  const [formState, setFormState] = React.useState<{
    email: string
    password: string
  }>({
    email: '',
    password: ''
  })

  const handleOnSubmit: React.FormEventHandler<HTMLFormElement> = async e => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const { email, password } = formState
      let userCredential

      if (action === 'sign-in') {
        userCredential = await signInWithEmailAndPassword(auth, email, password)
      } else {
        userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        )
      }

      // Get the ID token and create a server-side session cookie
      const idToken = await userCredential.user.getIdToken()
      const ok = await postSessionCookie(idToken)

      if (!ok) {
        toast.error('Failed to create session. Please try again.')
        setIsLoading(false)
        return
      }

      router.push(redirectedFrom ?? '/')
      router.refresh()
    } catch (err: any) {
      const message =
        err?.code === 'auth/user-not-found'
          ? 'No account found with that email.'
          : err?.code === 'auth/wrong-password'
            ? 'Incorrect password.'
            : err?.code === 'auth/email-already-in-use'
              ? 'An account with that email already exists.'
              : err?.code === 'auth/weak-password'
                ? 'Password should be at least 6 characters.'
                : err?.message ?? 'Authentication failed.'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div {...props}>
      <form onSubmit={handleOnSubmit}>
        <fieldset className="flex flex-col gap-y-4">
          <div className="flex flex-col gap-y-1">
            <Label className="font-switzer text-sm font-medium text-black-primary dark:text-card-foreground">
              Email
            </Label>
            <Input
              name="email"
              type="email"
              value={formState.email}
              onChange={e =>
                setFormState(prev => ({
                  ...prev,
                  email: e.target.value
                }))
              }
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label className="font-switzer text-sm font-medium text-black-primary dark:text-card-foreground">
              Password
            </Label>
            <Input
              name="password"
              type="password"
              value={formState.password}
              onChange={e =>
                setFormState(prev => ({
                  ...prev,
                  password: e.target.value
                }))
              }
            />
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col gap-4">
          <Button
            disabled={isLoading}
            className="w-full rounded-full font-switzer"
          >
            {isLoading && <IconSpinner className="mr-2 animate-spin" />}
            {action === 'sign-in' ? 'Sign In' : 'Sign Up'}
          </Button>
          <p className="text-center font-switzer text-sm text-gray-secondary dark:text-muted-foreground">
            {action === 'sign-in' ? (
              <>
                Don&apos;t have an account?{' '}
                <Link
                  href={
                    redirectedFrom
                      ? `/sign-up?redirectedFrom=${encodeURIComponent(redirectedFrom)}`
                      : '/sign-up'
                  }
                  className="font-medium text-black-primary hover:underline dark:text-card-foreground"
                >
                  Sign Up
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link
                  href={
                    redirectedFrom
                      ? `/sign-in?redirectedFrom=${encodeURIComponent(redirectedFrom)}`
                      : '/sign-in'
                  }
                  className="font-medium text-black-primary hover:underline dark:text-card-foreground"
                >
                  Sign In
                </Link>
              </>
            )}
          </p>
        </div>
      </form>
    </div>
  )
}
