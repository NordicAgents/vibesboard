import { auth } from '@/auth'
import { LoginButton } from '@/components/login-button'
import { GoogleLoginButton } from '@/components/google-login-button'
import { LoginForm } from '@/components/login-form'
import { Separator } from '@/components/ui/separator'
import { redirect } from 'next/navigation'
import { getSafeRedirectPath } from '@/lib/redirects'

export default async function SignInPage({
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
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-[#F5F0E8] px-4 py-8 dark:bg-[#1A1915] sm:px-6">
      {/* Card */}
      <div className="w-full max-w-[400px] animate-fade-slide-in">
        {/* Logo / Brand mark */}
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-normal text-[#1A1915] dark:text-[#E8E3D8]">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-[#6B6560] dark:text-[#9D9790]">
            Sign in to continue to vibesboard
          </p>
        </div>

        <div className="rounded-2xl border border-[#E2DDD4] bg-[#FDFAF5] p-6 shadow-[0_1px_3px_rgba(26,25,21,0.06),_0_4px_16px_rgba(26,25,21,0.04)] dark:border-[#2E2B25] dark:bg-[#221F1A] sm:p-8">
          <LoginForm
            action="sign-in"
            redirectedFrom={redirectedFrom ?? undefined}
          />

          <div className="relative my-6">
            <Separator className="bg-[#E2DDD4] dark:bg-[#2E2B25]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#FDFAF5] px-3 text-xs text-[#9D9790] dark:bg-[#221F1A]">
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
