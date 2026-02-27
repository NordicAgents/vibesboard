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
        'text-[#1A1915] hover:bg-[#EDE8DE] dark:text-[#E8E3D8] dark:hover:bg-[#2E2B25]',
        isActive && 'bg-[#EDE8DE] dark:bg-[#2E2B25]'
      )}
      style={
        isActive
          ? {
              boxShadow: 'inset 2px 0 0 0 #D97757'
            }
          : undefined
      }
    >
      <IconUser
        className={cn(
          'h-4 w-4 flex-none transition-colors duration-150',
          isActive
            ? 'text-[#D97757]'
            : 'text-[#9D9790] group-hover:text-[#D97757]'
        )}
      />
      <span className="truncate text-sm font-medium">{agent.name}</span>
    </Link>
  )
}
