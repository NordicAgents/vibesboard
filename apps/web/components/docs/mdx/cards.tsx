import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { cn } from '@vibesboard/utils'

export function Cards({ children }: { children: ReactNode }) {
  return (
    <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">{children}</div>
  )
}

export function Card({
  href,
  title,
  children,
  external
}: {
  href: string
  title: string
  children?: ReactNode
  external?: boolean
}) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={cn(
        'card-lift group flex flex-col gap-1.5 rounded-xl border border-border-warm bg-bg-surface p-4',
        'hover:border-accent-orange/50 transition-colors'
      )}
    >
      <span className="flex items-center gap-1.5 font-medium text-text-primary">
        {title}
        <ArrowRight className="size-3.5 -translate-x-0.5 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
      {children && (
        <span className="text-sm leading-relaxed text-text-secondary">
          {children}
        </span>
      )}
    </Link>
  )
}
