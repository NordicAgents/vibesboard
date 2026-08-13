import {
  BookOpen,
  CalendarCheck,
  History,
  Inbox,
  Layers,
  Route,
  Share2,
  Wrench
} from 'lucide-react'

import {
  LANDING_CAPABILITIES,
  LANDING_CAPABILITIES_HEADING,
  type LandingCapabilityIcon
} from '@/lib/landing-sections-copy'

import { FadeIn } from './fade-in'
import { LandingSection } from './landing-section'

/** Copy stays serialisable in lib/; the icon mapping lives with the markup. */
const ICONS: Record<LandingCapabilityIcon, React.ElementType> = {
  knowledge: BookOpen,
  channels: Inbox,
  tools: Wrench,
  scheduling: CalendarCheck,
  models: Route,
  tenancy: Layers,
  hooks: History,
  sharing: Share2
}

export function LandingCapabilities() {
  return (
    <LandingSection
      id="capabilities"
      label="[04] Capabilities"
      heading={LANDING_CAPABILITIES_HEADING}
      contentClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {LANDING_CAPABILITIES.map((capability, index) => {
        const Icon = ICONS[capability.icon]
        return (
          <FadeIn key={capability.title} delay={0.04 * index}>
            <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-primary/30 hover:bg-white/[0.06]">
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-4 font-switzer text-base font-medium text-foreground">
                {capability.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {capability.body}
              </p>
            </div>
          </FadeIn>
        )
      })}
    </LandingSection>
  )
}
