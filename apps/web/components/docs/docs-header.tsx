import Link from 'next/link'
import { Star } from 'lucide-react'

import { IconGitHub } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { getGitHubStars } from '@/lib/github-stars'
import { formatStarCount } from '@/lib/format-star-count'
import { LANDING_LINKS } from '@/lib/landing-links'
import { DocsSearchTrigger } from '@/components/docs/docs-search'
import { DocsMobileNav } from '@/components/docs/docs-mobile-nav'

export async function DocsHeader() {
  const stars = await getGitHubStars()
  const showStars = typeof stars === 'number' && stars > 0

  return (
    <header className="safe-area-inset-top bg-bg-base/85 sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border-warm px-4 backdrop-blur-md sm:px-6">
      <DocsMobileNav />

      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 font-switzer text-lg font-bold tracking-[-0.06em] text-text-primary"
      >
        vibesboard
        <span className="label-caps rounded-full border border-border-warm px-2 py-0.5 text-[10px] text-text-tertiary">
          docs
        </span>
      </Link>

      <div className="flex flex-1 justify-center px-2 sm:px-6">
        <DocsSearchTrigger />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Link
          href={LANDING_LINKS.repo}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:border-accent-orange/40 hidden items-center gap-1.5 rounded-full border border-border-warm px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-text-secondary transition-colors hover:text-text-primary sm:flex"
        >
          <IconGitHub className="size-3.5" />
          {showStars && (
            <span className="flex items-center gap-1 border-l border-border-warm pl-1.5 text-text-tertiary">
              <Star className="size-3 fill-current" aria-hidden />
              {formatStarCount(stars)}
            </span>
          )}
        </Link>
        <ThemeToggle />
        <Button
          variant="outline"
          size="sm"
          asChild
          className="hidden sm:inline-flex"
        >
          <Link href={LANDING_LINKS.signIn}>Sign in</Link>
        </Button>
      </div>
    </header>
  )
}
