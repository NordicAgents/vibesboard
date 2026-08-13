import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { LANDING_LINKS } from '@/lib/landing-links'
import {
  LANDING_MODELS_BODY,
  LANDING_MODELS_HEADING,
  LANDING_MODEL_PROVIDERS
} from '@/lib/landing-sections-copy'

import { FadeIn } from './fade-in'
import { LandingSection } from './landing-section'

export function LandingModels() {
  return (
    <LandingSection
      id="models"
      label="[05] Models"
      heading={LANDING_MODELS_HEADING}
      description={LANDING_MODELS_BODY}
    >
      <FadeIn>
        <div className="flex flex-wrap items-center gap-3">
          {LANDING_MODEL_PROVIDERS.map(provider => (
            <span
              key={provider}
              className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 font-switzer text-sm text-foreground/85"
            >
              {provider}
            </span>
          ))}
        </div>

        <Link
          href={LANDING_LINKS.byoLlm}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-6 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-primary transition-colors hover:text-foreground"
        >
          How model routing works
          <ArrowUpRight
            className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </FadeIn>
    </LandingSection>
  )
}
