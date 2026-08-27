import Link from 'next/link'

import { cn } from '@vibesboard/utils'
import { IconGitHub } from '@/components/ui/icons'
import { LANDING_LINKS } from '@/lib/landing-links'

/**
 * The header links directly to the open-source repository. Keeping it static
 * avoids a GitHub API request on every marketing-page render.
 */
export function GitHubStarButton({
  className
}: {
  className?: string
}) {
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
      <span className="sr-only">Vibesboard on GitHub</span>
    </Link>
  )
}
