'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type VibeAgent } from '@/lib/types'
import { cn } from '@/lib/utils'
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
        'group relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150',
        'text-[#222f30] hover:bg-[#e6ede6] dark:text-[#f5f8f7] dark:hover:bg-[#253435]',
        isActive && 'bg-[#e6ede6] dark:bg-[#253435]'
      )}
      style={
        isActive
          ? {
              boxShadow: 'inset 2px 0 0 0 #a7e26e'
            }
          : undefined
      }
    >
      <IconUser
        className={cn(
          'size-4 flex-none transition-colors duration-150',
          isActive
            ? 'text-accent-orange'
            : 'text-[#6f7f80] group-hover:text-accent-orange'
        )}
      />
      <span className="truncate text-sm font-medium">{agent.name}</span>
    </Link>
  )
}
