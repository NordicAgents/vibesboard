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
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-beige-bg px-4 py-6 dark:bg-background sm:px-6 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-black-10 bg-purewhite-bg p-6 shadow-lg dark:border-border dark:bg-card sm:rounded-3xl sm:p-8">
        <div className="mb-4 text-center sm:mb-6">
          <h1 className="font-switzer text-2xl font-bold text-black-primary dark:text-card-foreground sm:text-3xl">
            Welcome back
          </h1>
          <p className="mt-2 font-switzer text-sm text-gray-secondary dark:text-muted-foreground">
            Sign in to continue to vibesboard
          </p>
        </div>
        <LoginForm
          action="sign-in"
          redirectedFrom={redirectedFrom ?? undefined}
        />
        <Separator className="my-4 sm:my-6" />
        <div className="flex flex-col gap-2">
          <LoginButton redirectedFrom={redirectedFrom ?? undefined} />
          <GoogleLoginButton
            redirectedFrom={redirectedFrom ?? undefined}
          />
        </div>
      </div>
    </div>
  )
}
