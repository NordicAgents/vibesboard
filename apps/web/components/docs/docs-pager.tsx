import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import type { DocNavPage } from '@/lib/docs/nav'

export function DocsPager({
  prev,
  next
}: {
  prev: DocNavPage | null
  next: DocNavPage | null
}) {
  if (!prev && !next) return null

  return (
    <div className="mt-12 grid gap-3 border-t border-border-warm pt-6 sm:grid-cols-2">
      {prev ? (
        <Link
          href={`/docs/${prev.slug}`}
          className="card-lift group flex flex-col gap-1 rounded-xl border border-border-warm bg-bg-surface p-4"
        >
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <ArrowLeft className="size-3.5" />
            Previous
          </span>
          <span className="font-medium text-text-primary group-hover:text-accent-orange">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={`/docs/${next.slug}`}
          className="card-lift group flex flex-col items-end gap-1 rounded-xl border border-border-warm bg-bg-surface p-4 text-right sm:col-start-2"
        >
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
            Next
            <ArrowRight className="size-3.5" />
          </span>
          <span className="font-medium text-text-primary group-hover:text-accent-orange">
            {next.title}
          </span>
        </Link>
      )}
    </div>
  )
}
