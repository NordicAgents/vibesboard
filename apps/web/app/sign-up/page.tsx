'use client'

import { LoginForm } from '@/components/login-form'
import { GoogleLoginButton } from '@/components/google-login-button'
import { Separator } from '@/components/ui/separator'
import { useSearchParams } from 'next/navigation'
import { getSafeRedirectPath } from '@/lib/redirects'

export default function SignUpPage() {
  const searchParams = useSearchParams()
  const rawRedirectedFrom =
    searchParams.get('redirectedFrom') ?? searchParams.get('next') ?? undefined
  const redirectedFrom = getSafeRedirectPath(rawRedirectedFrom) ?? undefined

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-[#f7f7f5] px-4 py-8 dark:bg-[#111918] sm:px-6">
      <div className="w-full max-w-[400px] animate-fade-slide-in">
        <div className="mb-8 text-center">
          <h1 className="font-sans text-3xl font-medium text-[#222f30] dark:text-[#f5f8f7]">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-[#445e5f] dark:text-[#6f7f80]">
            Start building with vibesboard
          </p>
        </div>

        <div className="rounded-[1.75rem] border border-[#e4e3e3] bg-[#f5f8f7] p-6 shadow-soft dark:border-[#344348] dark:bg-[#192425] sm:p-8">
          <LoginForm action="sign-up" redirectedFrom={redirectedFrom} />

          <div className="relative my-6">
            <Separator className="bg-[#e4e3e3] dark:bg-[#344348]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#f5f8f7] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#6f7f80] dark:bg-[#192425] dark:text-[#c9cbbe]">
              or continue with
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <GoogleLoginButton redirectedFrom={redirectedFrom} />
          </div>
        </div>
      </div>
    </div>
  )
}
