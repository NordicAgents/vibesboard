import { Suspense } from 'react'
import { ResetPasswordForm } from '@/components/reset-password-form'

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center bg-[#f7f7f5] px-4 py-8 dark:bg-[#111918] sm:px-6">
      <div className="w-full max-w-[400px] animate-fade-slide-in">
        <div className="mb-8 text-center">
          <h1 className="font-sans text-3xl font-medium text-[#222f30] dark:text-[#f5f8f7]">
            Choose a new password
          </h1>
          <p className="mt-2 text-sm text-[#445e5f] dark:text-[#6f7f80]">
            Enter a new password for your account
          </p>
        </div>

        <div className="rounded-[1.75rem] border border-[#e4e3e3] bg-[#f5f8f7] p-6 shadow-soft dark:border-[#344348] dark:bg-[#192425] sm:p-8">
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
