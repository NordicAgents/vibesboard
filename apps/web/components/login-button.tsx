'use client'

// GitHub OAuth has been removed from the auth stack.
// This component is kept as a no-op stub so existing imports do not break.
// It can be deleted once all call sites are cleaned up.

import type { ButtonProps } from '@/components/ui/button'

interface LoginButtonProps extends ButtonProps {
  showGithubIcon?: boolean
  text?: string
  redirectedFrom?: string
}

export function LoginButton(_props: LoginButtonProps) {
  return null
}
