'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@vibesboard/utils'
import { DOCS_NAV } from '@/lib/docs/nav'

export function DocsSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-6">
      <Link
        href="/docs"
        onClick={onNavigate}
        className={cn(
          'rounded-lg px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-hover',
          pathname === '/docs' && 'sidebar-active'
        )}
      >
        Overview
      </Link>

      {DOCS_NAV.map(section => (
        <div key={section.title}>
          <p className="label-caps mb-2 px-3">{section.title}</p>
          <ul className="flex flex-col gap-0.5">
            {section.pages.map(page => {
              const href = `/docs/${page.slug}`
              const active = pathname === href
              return (
                <li key={page.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    className={cn(
                      'block rounded-lg px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary',
                      active && 'sidebar-active font-medium text-text-primary'
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
