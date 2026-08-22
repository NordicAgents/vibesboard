import {
  LANDING_CHANNELS_BODY,
  LANDING_CHANNELS_HEADING,
  LANDING_CHANNELS_POINTS
} from '@/lib/landing-sections-copy'
import { LANDING_MEDIA_INBOX_HANDOFF } from '@/lib/landing-media'

import { FadeIn } from './fade-in'
import { LandingMedia } from './landing-media'
import { BrowserFrame, LandingSection } from './landing-section'

export function LandingChannels() {
  return (
    <LandingSection
      id="channels"
      label="[03] Channels & inbox"
      heading={LANDING_CHANNELS_HEADING}
      description={LANDING_CHANNELS_BODY}
      contentClassName="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16"
    >
      <FadeIn>
        <BrowserFrame label="Channel inbox — WhatsApp thread">
          <LandingMedia
            asset={LANDING_MEDIA_INBOX_HANDOFF}
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        </BrowserFrame>
      </FadeIn>

      <div className="grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2">
        {LANDING_CHANNELS_POINTS.map((point, index) => (
          <FadeIn
            key={point.title}
            delay={0.05 * index}
            // Not `direction="left"`: the pre-animation state offsets the card
            // 40px to the right, which lets a phone scroll sideways until the
            // card enters view.
            className="bg-background p-6"
          >
            <h3 className="font-switzer text-base font-medium text-foreground">
              {point.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {point.body}
            </p>
          </FadeIn>
        ))}
      </div>
    </LandingSection>
  )
}
