import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { getGitHubStars } from '@/lib/github-stars'
import { LANDING_LINKS, LANDING_NAV_LINKS } from '@/lib/landing-links'

import { GitHubStarButton } from './github-star-button'

/**
 * Marketing header.
 *
 * Deliberately not a product menu: an open-source project is navigated through
 * its repository, so the header is the wordmark, the repo and a sign-in.
 * Sibling products and the docs tree live in the footer.
 *
 * With `LANDING_NAV_LINKS` empty there are only two actions, so they render
 * inline at every width instead of hiding behind a hamburger — a menu holding
 * two buttons is a tap nobody should have to make.
 *
 * Carries the `dark` class itself so it renders identically on the landing page
 * and on the legal pages, regardless of the visitor's app theme.
 */
export async function LandingHeader() {
  const stars = await getGitHubStars()

  return (
    <header className="safe-area-inset-top dark fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background/80 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4">
      <div className="flex items-center gap-6 lg:gap-10">
        <Link
          href="/"
          className="font-switzer text-xl font-bold tracking-[-0.08em] text-foreground sm:text-2xl"
        >
          vibesboard
        </Link>

        {LANDING_NAV_LINKS.length > 0 && (
          <nav className="hidden items-center gap-6 md:flex lg:gap-8">
            {LANDING_NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <GitHubStarButton stars={stars} />
        <Button variant="outline" className="px-4 lg:px-6" asChild>
          <Link href={LANDING_LINKS.signIn}>Sign in</Link>
        </Button>
      </div>
    </header>
  )
}
