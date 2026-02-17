'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type VibeAgent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { IconUser } from '@/components/ui/icons'

interface SidebarAgentItemProps {
  agent: VibeAgent
}

export function SidebarAgentItem({ agent }: SidebarAgentItemProps) {
  const pathname = usePathname()
  const path = `/agents/${agent.id}`
  const isActive = pathname?.startsWith(path)

  return (
    <Link
      href={`${path}?configure=true`}
      title={agent.name}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'group flex w-full items-center justify-start gap-2 pl-2 pr-3 text-left',
        isActive && 'bg-accent'
      )}
    >
      <IconUser className="h-4 w-4 flex-none" />
      <span className="truncate text-sm font-medium">{agent.name}</span>
    </Link>
  )
}
