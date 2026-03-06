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
        'text-[#1A1A1A] hover:bg-[#EFEFED] dark:text-[#F0F0F0] dark:hover:bg-[#1E1E1E]',
        isActive && 'bg-[#EFEFED] dark:bg-[#1E1E1E]'
      )}
      style={
        isActive
          ? {
              boxShadow: 'inset 2px 0 0 0 #00C853'
            }
          : undefined
      }
    >
      <IconUser
        className={cn(
          'size-4 flex-none transition-colors duration-150',
          isActive
            ? 'text-accent-orange'
            : 'text-[#8A8A8A] group-hover:text-accent-orange'
        )}
      />
      <span className="truncate text-sm font-medium">{agent.name}</span>
    </Link>
  )
}
