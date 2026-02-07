'use client'

import { usePathname } from 'next/navigation'

export function AppHeaderController({
  children
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Hide header on app pages (agents, chat)
  // We check if the path starts with /agents or /chat
  const isAppPage =
    pathname?.startsWith('/agents') || pathname?.startsWith('/chat')

  if (isAppPage) {
    return null
  }

  return <>{children}</>
}
