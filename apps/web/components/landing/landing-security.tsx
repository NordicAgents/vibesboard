import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { LANDING_LINKS } from '@/lib/landing-links'
import {
  LANDING_SECURITY_HEADING,
  LANDING_SECURITY_POINTS
} from '@/lib/landing-sections-copy'

import { FadeIn } from './fade-in'
import { LandingSection } from './landing-section'

export function LandingSecurity() {
  return (
    <LandingSection
      id="security"
      label="[07] Security"
      heading={LANDING_SECURITY_HEADING}
      contentClassName="grid gap-6 sm:grid-cols-2"
    >
      {LANDING_SECURITY_POINTS.map((point, index) => (
        <FadeIn key={point.title} delay={0.05 * index}>
          <div className="h-full border-l border-primary/40 pl-5">
            <h3 className="font-switzer text-base font-medium text-foreground">
              {point.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {point.body}
            </p>
          </div>
        </FadeIn>
      ))}

      <FadeIn className="sm:col-span-2">
        <Link
          href={LANDING_LINKS.security}
          className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-primary transition-colors hover:text-foreground"
        >
          Read the security model
          <ArrowUpRight
            className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </FadeIn>
    </LandingSection>
  )
}
