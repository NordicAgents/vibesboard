import { auth } from '@/auth'
import { LoginButton } from '@/components/login-button'
import { GoogleLoginButton } from '@/components/google-login-button'
import { LoginForm } from '@/components/login-form'
import { Separator } from '@/components/ui/separator'
import { redirect } from 'next/navigation'
import { getSafeRedirectPath } from '@/lib/redirects'

export default async function SignUpPage({
  searchParams
}: {
  searchParams: Promise<{
    redirectedFrom?: string | string[]
    next?: string | string[]
  }>
}) {
  const query = await searchParams
  const rawRedirectedFrom = Array.isArray(query.redirectedFrom)
    ? query.redirectedFrom[0]
    : query.redirectedFrom
  const rawNext = Array.isArray(query.next) ? query.next[0] : query.next
  const redirectedFrom = getSafeRedirectPath(rawRedirectedFrom ?? rawNext)

  const session = await auth()
  if (session?.user) {
    redirect(redirectedFrom ?? '/')
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-[#FFFFFF] px-4 py-8 dark:bg-[#0A0A0A] sm:px-6">
      <div className="w-full max-w-[400px] animate-fade-slide-in">
        <div className="mb-8 text-center">
          <h1 className="font-sans text-3xl font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-[#5A5A5A] dark:text-[#8A8A8A]">
            Start building with vibesboard
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5E5E5] bg-[#F7F7F5] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),_0_4px_16px_rgba(0,0,0,0.04)] dark:border-[#2A2A2A] dark:bg-[#141414] sm:p-8">
          <LoginForm
            action="sign-up"
            redirectedFrom={redirectedFrom ?? undefined}
          />

          <div className="relative my-6">
            <Separator className="bg-[#E5E5E5] dark:bg-[#2A2A2A]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#F7F7F5] px-3 text-xs text-[#8A8A8A] dark:bg-[#141414] dark:text-[#A0A0A0]">
              or continue with
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <LoginButton redirectedFrom={redirectedFrom ?? undefined} />
            <GoogleLoginButton redirectedFrom={redirectedFrom ?? undefined} />
          </div>
        </div>
      </div>
    </div>
  )
}
