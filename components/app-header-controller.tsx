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
 '/terms-of-service',
 '/whatsapp-bulk',
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

 // Also hide on legacy /a paths
 const isLegacyAppPage = pathname?.startsWith('/a')

 if (isPublicAgentPage || isLegacyAppPage) {
 return null
 }

 return <>{children}</>
}
