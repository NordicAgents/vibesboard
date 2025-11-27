import { auth } from '@/auth'
import { LoginButton } from '@/components/login-button'
import { GoogleLoginButton } from '@/components/google-login-button'
import { LoginForm } from '@/components/login-form'
import { Separator } from '@/components/ui/separator'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function SignInPage() {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })
  // redirect to home if user is already logged in
  if (session?.user) {
    redirect('/')
  }
  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col items-center justify-center bg-beige-bg py-10">
      <div className="w-full max-w-md rounded-3xl border border-black-10 bg-purewhite-bg p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="font-switzer text-3xl font-bold text-black-primary">Welcome back</h1>
          <p className="mt-2 font-switzer text-sm text-gray-secondary">Sign in to continue to vibesboard</p>
        </div>
        <LoginForm action="sign-in" />
        <Separator className="my-6" />
        <div className="flex flex-col gap-2">
          <LoginButton />
          <GoogleLoginButton />
        </div>
      </div>
    </div>
  )
}
