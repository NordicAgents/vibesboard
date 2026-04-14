'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot } from 'lucide-react'

import { type VibeAgent } from '@/lib/types'
import { cn } from '@/lib/utils'

interface SidebarAgentItemProps {
  agent: VibeAgent
}

export function SidebarAgentItem({ agent }: SidebarAgentItemProps) {
  const pathname = usePathname()
  const path = `/agents/${agent.id}`
  const isActive = pathname?.startsWith(path)

  return (
    <Link
      href={`${path}?tab=configure`}
      title={agent.name}
      className={cn(
        'group relative flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all duration-150',
        isActive
          ? 'border-accent-orange/30 bg-accent-orange/5 dark:border-accent-orange/20 dark:bg-accent-orange/10'
          : 'border-[#e2ddd4] bg-white/60 hover:border-[#d0cbc2] hover:bg-white dark:border-[#2a3a3b] dark:bg-[#1a2627]/60 dark:hover:border-[#3a4a4b] dark:hover:bg-[#1a2627]',
        'text-[#222f30] dark:text-[#f5f8f7]'
      )}
    >
      <div
        className={cn(
          'flex size-7 flex-none items-center justify-center rounded-md transition-colors duration-150',
          isActive
            ? 'bg-accent-orange text-white'
            : 'bg-[#e6ede6] text-[#6f7f80] group-hover:bg-accent-orange/10 group-hover:text-accent-orange dark:bg-[#253435] dark:text-[#8a9a9b]'
        )}
      >
        <Bot className="size-4" />
      </div>
      <span className="min-w-0 truncate text-sm font-medium">{agent.name}</span>
    </Link>
  )
}
