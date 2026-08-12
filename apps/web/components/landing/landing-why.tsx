import {
  LANDING_WHY_HEADING,
  LANDING_WHY_ITEMS
} from '@/lib/landing-sections-copy'

import { FadeIn } from './fade-in'
import { LandingSection } from './landing-section'

export function LandingWhy() {
  return (
    <LandingSection
      id="why"
      label="[02] Why Vibesboard"
      heading={LANDING_WHY_HEADING}
      contentClassName="grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3"
    >
      {LANDING_WHY_ITEMS.map((item, index) => (
        <FadeIn
          key={item.need}
          delay={0.05 * index}
          className="bg-background p-6 lg:p-8"
        >
          <h3 className="font-switzer text-lg font-medium text-foreground">
            {item.need}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {item.answer}
          </p>
        </FadeIn>
      ))}
    </LandingSection>
  )
}
