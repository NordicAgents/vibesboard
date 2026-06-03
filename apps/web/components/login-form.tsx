'use client'

import * as React from 'react'
import { authClient } from '@/lib/auth-client'

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

export function LoginForm({
  className,
  action = 'sign-in',
  redirectedFrom,
  ...props
}: LoginFormProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [needsVerify, setNeedsVerify] = React.useState(false)
  const router = useRouter()

  const callbackURL = redirectedFrom ?? '/'

  const handleOnSubmit: React.FormEventHandler<HTMLFormElement> = async e => {
    e.preventDefault()
    setIsLoading(true)

    try {
      if (action === 'sign-in') {
        const { error } = await authClient.signIn.email({
          email,
          password,
          callbackURL
        })
        if (error) {
          toast.error(error.message ?? 'Sign-in failed')
          return
        }
        router.push(callbackURL)
        router.refresh()
      } else {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL
        })
        if (error) {
          toast.error(error.message ?? 'Sign-up failed')
          return
        }
        setNeedsVerify(true)
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Authentication failed.')
    } finally {
      setIsLoading(false)
    }
  }

  if (needsVerify) {
    return (
      <div {...props}>
        <p className="text-sm text-[#445e5f] dark:text-[#6f7f80]">
          We sent a verification link to <strong>{email}</strong>. Click it to
          finish creating your account.
        </p>
      </div>
    )
  }

  return (
    <div {...props}>
      <form onSubmit={handleOnSubmit}>
        <fieldset className="flex flex-col gap-y-4">
          {action === 'sign-up' && (
            <div className="flex flex-col gap-y-1.5">
              <Label>Name</Label>
              <Input
                name="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
          )}
          <div className="flex flex-col gap-y-1.5">
            <Label>Email</Label>
            <Input
              name="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label>Password</Label>
            <Input
              name="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={action === 'sign-up' ? 8 : undefined}
            />
            {action === 'sign-in' && (
              <Link
                href="/forgot-password"
                className="self-end text-sm font-medium text-accent-orange transition-colors hover:text-accent-warm"
              >
                Forgot password?
              </Link>
            )}
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col gap-4">
          <Button disabled={isLoading} className="w-full">
            {isLoading && <IconSpinner className="animate-spin" />}
            {action === 'sign-in' ? 'Sign In' : 'Create Account'}
          </Button>
          <p className="text-center text-sm text-[#445e5f] dark:text-[#6f7f80]">
            {action === 'sign-in' ? (
              <>
                Don&apos;t have an account?{' '}
                <Link
                  href={
                    redirectedFrom
                      ? `/sign-up?redirectedFrom=${encodeURIComponent(redirectedFrom)}`
                      : '/sign-up'
                  }
                  className="font-medium text-accent-orange transition-colors hover:text-accent-warm"
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
                  className="font-medium text-accent-orange transition-colors hover:text-accent-warm"
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
