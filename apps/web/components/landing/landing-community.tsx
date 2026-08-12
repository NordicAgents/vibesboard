import Link from 'next/link'
import { ArrowUpRight, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LANDING_MEDIA_CLOSING_WORDMARK } from '@/lib/landing-media'
import {
  LANDING_COMMUNITY_ACTIONS,
  LANDING_COMMUNITY_BODY,
  LANDING_COMMUNITY_HEADING
} from '@/lib/landing-sections-copy'

import { FadeIn } from './fade-in'
import { LandingMedia } from './landing-media'

export function LandingCommunity() {
  return (
    <section
      id="community"
      className="scroll-mt-24 border-t border-white/5 px-4 py-16 sm:px-6 sm:py-20 lg:py-24"
    >
      <div className="container mx-auto">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <FadeIn>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              [09] Community
            </h2>
            <p className="mt-4 font-switzer text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
              {LANDING_COMMUNITY_HEADING}
            </p>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
              {LANDING_COMMUNITY_BODY}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {LANDING_COMMUNITY_ACTIONS.map(action => (
                <Button
                  key={action.label}
                  size="lg"
                  variant={action.primary ? 'default' : 'outline'}
                  asChild
                >
                  <Link
                    href={action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {action.primary ? (
                      <Star className="size-4" aria-hidden />
                    ) : null}
                    {action.label}
                    {!action.primary && (
                      <ArrowUpRight className="size-4" aria-hidden />
                    )}
                  </Link>
                </Button>
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <LandingMedia
              asset={LANDING_MEDIA_CLOSING_WORDMARK}
              className="rounded-3xl border border-white/10"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
