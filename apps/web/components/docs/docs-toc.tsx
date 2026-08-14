'use client'

import { useEffect, useState } from 'react'

import { cn } from '@vibesboard/utils'
import type { DocHeading } from '@/lib/docs/content'

export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-96px 0px -70% 0px' }
    )

    for (const heading of headings) {
      const el = document.getElementById(heading.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto">
      <p className="label-caps mb-3">On this page</p>
      <ul className="flex flex-col gap-2 border-l border-border-warm text-sm">
        {headings.map(heading => (
          <li
            key={heading.id}
            style={{ paddingLeft: heading.depth === 3 ? '1.75rem' : '1rem' }}
          >
            <a
              href={`#${heading.id}`}
              className={cn(
                '-ml-px block border-l-2 border-transparent py-0.5 pl-3 text-text-tertiary transition-colors hover:text-text-primary',
                activeId === heading.id &&
                  'border-accent-orange font-medium text-text-primary'
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
