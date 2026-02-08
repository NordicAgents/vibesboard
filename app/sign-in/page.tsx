import { auth } from '@/auth'
import { LoginButton } from '@/components/login-button'
import { GoogleLoginButton } from '@/components/google-login-button'
import { LoginForm } from '@/components/login-form'
import { Separator } from '@/components/ui/separator'
import { cookies } from 'next/headers'
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

  const cookieStore = await cookies()
  const session = await auth({ cookieStore })
  // redirect to home if user is already logged in
  if (session?.user) {
    redirect(redirectedFrom ?? '/')
  }
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-beige-bg dark:bg-background py-6 sm:py-10 px-4 sm:px-6">
      <div className="w-full max-w-md rounded-2xl sm:rounded-3xl border border-black-10 dark:border-border bg-purewhite-bg dark:bg-card p-6 sm:p-8 shadow-lg">
        <div className="mb-4 sm:mb-6 text-center">
          <h1 className="font-switzer text-2xl sm:text-3xl font-bold text-black-primary dark:text-card-foreground">Welcome back</h1>
          <p className="mt-2 font-switzer text-sm text-gray-secondary dark:text-muted-foreground">Sign in to continue to vibesboard</p>
        </div>
        <LoginForm action="sign-in" redirectedFrom={redirectedFrom ?? undefined} />
        <Separator className="my-4 sm:my-6" />
        <div className="flex flex-col gap-2">
          <LoginButton redirectedFrom={redirectedFrom ?? undefined} />
          <GoogleLoginButton redirectedFrom={redirectedFrom ?? undefined} />
        </div>
      </div>
    </div>
  )
}
