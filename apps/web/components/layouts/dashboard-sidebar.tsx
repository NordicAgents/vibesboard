'use client'

import { ReactNode, useState } from 'react'
import { cn } from '@vibesboard/utils'
import { IconArrowDown, IconArrowUp } from '@/components/ui/icons'

interface DashboardSidebarProps {
  children: ReactNode
  title?: string
  className?: string
}

export function DashboardSidebar({
  children,
  title,
  className
}: DashboardSidebarProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {title && (
        <h2 className="font-switzer text-sm font-semibold uppercase tracking-wider text-black-primary dark:text-foreground">
          {title}
        </h2>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

interface DashboardSidebarSectionProps {
  children: ReactNode
  title?: string
  action?: ReactNode
  className?: string
  defaultExpanded?: boolean
}

export function DashboardSidebarSection({
  children,
  title,
  action,
  className,
  defaultExpanded = true
}: DashboardSidebarSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title ? (
            <button
              onClick={handleToggle}
              className="group flex cursor-pointer items-center gap-1.5 transition-opacity hover:opacity-80"
              type="button"
            >
              <h3 className="font-switzer text-xs font-medium uppercase tracking-wider text-gray-secondary group-hover:text-black-primary dark:group-hover:text-foreground">
                {title}
              </h3>
              <div className="shrink-0">
                {isExpanded ? (
                  <IconArrowUp className="size-3.5 text-gray-secondary group-hover:text-black-primary dark:group-hover:text-foreground" />
                ) : (
                  <IconArrowDown className="size-3.5 text-gray-secondary group-hover:text-black-primary dark:group-hover:text-foreground" />
                )}
              </div>
            </button>
          ) : (
            <div />
          )}
          {action}
        </div>
      )}
      {isExpanded && <div className="flex flex-col gap-1">{children}</div>}
    </div>
  )
}

interface DashboardSidebarItemProps {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

export function DashboardSidebarItem({
  children,
  active = false,
  onClick,
  className
}: DashboardSidebarItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      data-mobile-menu-close="true"
      className={cn(
        'rounded-2xl px-3 py-2 text-left font-switzer text-sm transition-colors cursor-pointer',
        active
          ? 'bg-black-primary text-purewhite-bg'
          : 'hover:bg-beige-bg/50 text-black-primary dark:text-foreground dark:hover:bg-white/5',
        className
      )}
    >
      {children}
    </div>
  )
}
