'use client'

import * as React from 'react'
import { authClient } from '@/lib/auth-client'

import { Button } from '@/components/ui/button'
import { IconSpinner } from '@/components/ui/icons'
import { Input } from './ui/input'
import { Label } from './ui/label'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

export function ForgotPasswordForm(
  props: React.ComponentPropsWithoutRef<'div'>
) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [sent, setSent] = React.useState(false)

  const handleOnSubmit: React.FormEventHandler<HTMLFormElement> = async e => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password'
      })
      if (error) {
        toast.error(error.message ?? 'Could not send reset link')
        return
      }
      // Always confirm regardless, so we don't leak which emails exist.
      setSent(true)
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not send reset link.')
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
    return (
      <div {...props}>
        <p className="text-sm text-[#445e5f] dark:text-[#6f7f80]">
          If an account exists for <strong>{email}</strong>, we sent a password
          reset link. Click it to choose a new password.
        </p>
        <p className="mt-6 text-center text-sm text-[#445e5f] dark:text-[#6f7f80]">
          <Link
            href="/sign-in"
            className="font-medium text-accent-orange transition-colors hover:text-accent-warm"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div {...props}>
      <form onSubmit={handleOnSubmit}>
        <fieldset className="flex flex-col gap-y-4">
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
        </fieldset>

        <div className="mt-6 flex flex-col gap-4">
          <Button disabled={isLoading} className="w-full">
            {isLoading && <IconSpinner className="animate-spin" />}
            Send reset link
          </Button>
          <p className="text-center text-sm text-[#445e5f] dark:text-[#6f7f80]">
            Remembered it?{' '}
            <Link
              href="/sign-in"
              className="font-medium text-accent-orange transition-colors hover:text-accent-warm"
            >
              Sign In
            </Link>
          </p>
        </div>
      </form>
    </div>
  )
}
