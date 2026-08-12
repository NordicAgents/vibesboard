'use client'

import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { LANDING_MEDIA_AGENT_CREATOR } from '@/lib/landing-media'
import {
  LANDING_HERO_BADGES,
  LANDING_HERO_COMMAND,
  LANDING_HERO_HEADING_HIGHLIGHT,
  LANDING_HERO_HEADING_LEAD,
  LANDING_HERO_PRIMARY_CTA,
  LANDING_HERO_SECONDARY_CTA,
  LANDING_HERO_SUBHEADING
} from '@/lib/landing-hero-copy'

import { BrowserFrame } from './landing-section'
import { LandingMedia } from './landing-media'
import { TerminalBlock } from './terminal-block'

const ease = [0.21, 0.47, 0.32, 0.98] as const

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease }
})

export function LandingHero() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:px-6 sm:pb-20 sm:pt-32 lg:pb-24 lg:pt-40">
      {/* Aurora wash behind the headline, matching the brand media below it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[36rem] bg-[radial-gradient(60%_50%_at_35%_40%,rgba(167,226,110,0.16),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(70%_60%_at_50%_20%,black,transparent)]"
      />

      <div className="container relative mx-auto">
        {/* min-w-0 on the columns: without it a grid item's automatic minimum
            size is its min-content width, and the clone URL in the terminal
            pushes the whole column past the viewport on phones. */}
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div className="min-w-0">
            <motion.div
              {...rise(0)}
              className="flex flex-wrap items-center gap-2"
            >
              {LANDING_HERO_BADGES.map(badge => (
                <span
                  key={badge}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {badge}
                </span>
              ))}
            </motion.div>

            <motion.h1
              {...rise(0.08)}
              className="mt-6 font-switzer text-4xl font-bold leading-[1.02] tracking-[-0.03em] text-foreground sm:text-5xl xl:text-6xl"
            >
              {LANDING_HERO_HEADING_LEAD}{' '}
              <span className="text-primary">
                {LANDING_HERO_HEADING_HIGHLIGHT}
              </span>
            </motion.h1>

            <motion.p
              {...rise(0.16)}
              className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
            >
              {LANDING_HERO_SUBHEADING}
            </motion.p>

            <motion.div
              {...rise(0.24)}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Button size="lg" asChild>
                <Link href={LANDING_HERO_PRIMARY_CTA.href}>
                  {LANDING_HERO_PRIMARY_CTA.label}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link
                  href={LANDING_HERO_SECONDARY_CTA.href}
                  target={
                    LANDING_HERO_SECONDARY_CTA.external ? '_blank' : undefined
                  }
                  rel={
                    LANDING_HERO_SECONDARY_CTA.external
                      ? 'noopener noreferrer'
                      : undefined
                  }
                >
                  {LANDING_HERO_SECONDARY_CTA.label}
                  <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </motion.div>
          </div>

          <motion.div {...rise(0.32)} className="min-w-0">
            <TerminalBlock command={LANDING_HERO_COMMAND} />
          </motion.div>
        </div>

        {/* The agent creator gets the full container width below the fold-line
            rather than half a hero column — at 16:9 it is unreadable small, and
            it is the one asset that shows the product doing the work. */}
        <motion.div
          className="mt-14 lg:mt-20"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease }}
        >
          <BrowserFrame label="Describe an agent — it configures itself">
            <LandingMedia
              asset={LANDING_MEDIA_AGENT_CREATOR}
              priority
              sizes="100vw"
            />
          </BrowserFrame>
        </motion.div>
      </div>
    </section>
  )
}
