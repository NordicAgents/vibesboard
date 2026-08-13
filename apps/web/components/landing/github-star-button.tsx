import Link from 'next/link'
import { Star } from 'lucide-react'

import { cn } from '@vibesboard/utils'
import { IconGitHub } from '@/components/ui/icons'
import { formatStarCount } from '@/lib/format-star-count'
import { LANDING_LINKS } from '@/lib/landing-links'

/**
 * The star count is the social proof on an open-source landing page, so it goes
 * in the header. When the count is unknown (GitHub down, rate limited) or still
 * zero, the button degrades to a plain repo link — a "★ 0" badge argues against
 * the project.
 */
export function GitHubStarButton({
  stars,
  className
}: {
  stars: number | null
  className?: string
}) {
  const showCount = typeof stars === 'number' && stars > 0

  return (
    <Link
      href={LANDING_LINKS.repo}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:border-primary/50 hover:bg-white/10',
        className
      )}
    >
      <IconGitHub className="size-4" />
      {/* Icon-only on phones so the wordmark, repo and sign-in all fit. */}
      <span className="hidden sm:inline">GitHub</span>
      {showCount && (
        <span className="flex items-center gap-1 border-l border-white/15 pl-2 text-primary">
          <Star className="size-3 fill-current" aria-hidden />
          {formatStarCount(stars)}
        </span>
      )}
      <span className="sr-only">
        {showCount
          ? `Vibesboard on GitHub, ${stars} stars`
          : 'Vibesboard on GitHub'}
      </span>
    </Link>
  )
}
