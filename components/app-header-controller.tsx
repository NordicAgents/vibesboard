'use client'

import { usePathname } from 'next/navigation'

export function AppHeaderController({
  children
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Hide header on app pages (agents, chat, public agent pages)
  // We check if the path starts with /agents, /chat, or /a
  const isAppPage =
    pathname?.startsWith('/agents') ||
    pathname?.startsWith('/chat') ||
    pathname?.startsWith('/a')

  if (isAppPage) {
    return null
  }

  return <>{children}</>
}
