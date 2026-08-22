'use client'

import * as React from 'react'
import { authClient } from '@/lib/auth-client'

import { Button } from '@/components/ui/button'
import { IconSpinner } from '@/components/ui/icons'
import { Input } from './ui/input'
import { Label } from './ui/label'
import Link from 'next/link'
import { toast } from 'react-hot-toast'
import { useRouter, useSearchParams } from 'next/navigation'

export function ResetPasswordForm(
  props: React.ComponentPropsWithoutRef<'div'>
) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? undefined
  const linkError = searchParams.get('error') ?? undefined

  const [isLoading, setIsLoading] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')

  const handleOnSubmit: React.FormEventHandler<HTMLFormElement> = async e => {
    e.preventDefault()
    if (!token) {
      toast.error('Missing or invalid reset token.')
      return
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.')
      return
    }
    setIsLoading(true)

    try {
      const { error } = await authClient.resetPassword({
        newPassword: password,
        token
      })
      if (error) {
        toast.error(error.message ?? 'Could not reset password')
        return
      }
      toast.success('Password updated. Please sign in.')
      router.push('/sign-in')
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not reset password.')
    } finally {
      setIsLoading(false)
    }
  }

  if (linkError || !token) {
    return (
      <div {...props}>
        <p className="text-sm text-[#445e5f] dark:text-[#6f7f80]">
          This password reset link is invalid or has expired.
        </p>
        <p className="mt-6 text-center text-sm text-[#445e5f] dark:text-[#6f7f80]">
          <Link
            href="/forgot-password"
            className="font-medium text-accent-orange transition-colors hover:text-accent-warm"
          >
            Request a new link
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
            <Label>New password</Label>
            <Input
              name="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label>Confirm password</Label>
            <Input
              name="confirm"
              type="password"
              placeholder="••••••••"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col gap-4">
          <Button disabled={isLoading} className="w-full">
            {isLoading && <IconSpinner className="animate-spin" />}
            Reset password
          </Button>
          <p className="text-center text-sm text-[#445e5f] dark:text-[#6f7f80]">
            <Link
              href="/sign-in"
              className="font-medium text-accent-orange transition-colors hover:text-accent-warm"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </form>
    </div>
  )
}
