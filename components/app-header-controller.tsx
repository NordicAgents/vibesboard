'use client'

import { usePathname } from 'next/navigation'

// Known system-level route prefixes that show the app header
const SYSTEM_PREFIXES = [
  '/agents',
  '/chat',
  '/admin',
  '/settings',
  '/sign-in',
  '/sign-up',
  '/invite',
  '/share',
  '/landing',
  '/privacy-policy',
  '/terms-of-service'
]

export function AppHeaderController({
  children
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  const isSystemPath = SYSTEM_PREFIXES.some(p => pathname?.startsWith(p))
  const segments = pathname?.split('/').filter(Boolean) ?? []

  // Public agent pages: exactly 2 segments, not a known system path
  // e.g. /user-WlgbEdFb/calcbuddy
  const isPublicAgentPage = !isSystemPath && segments.length === 2

  // Hide on landing page (has its own header) and routes with their own nav
  const isLandingPage = pathname === '/' || pathname === '/landing'
  const hasOwnNavigation = pathname?.startsWith('/agents')

  if (isPublicAgentPage || isLandingPage || hasOwnNavigation) {
    return null
  }

  return <>{children}</>
}
