import { LandingCapabilities } from './landing-capabilities'
import { LandingChannels } from './landing-channels'
import { LandingCommunity } from './landing-community'
import { LandingDeploy } from './landing-deploy'
import { LandingFooter } from './landing-footer'
import { LandingHeader } from './landing-header'
import { LandingHero } from './landing-hero'
import { LandingModels } from './landing-models'
import { LandingQuickstart } from './landing-quickstart'
import { LandingSecurity } from './landing-security'
import { LandingWhy } from './landing-why'

/**
 * The marketing page, rendered both at `/` (for logged-out visitors) and at
 * `/landing`. Defined once so the two routes cannot drift apart.
 *
 * The tree is pinned to the dark palette with a `dark` class rather than
 * following the visitor's app theme: the brand media is dark-ground artwork,
 * and a light marketing page under it looks like two different products.
 */
export function LandingPage() {
  return (
    <div className="dark h-full overflow-y-auto bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <LandingHeader />
      <LandingHero />
      <div className="hidden md:contents">
        <LandingQuickstart />
        <LandingWhy />
        <LandingChannels />
        <LandingCapabilities />
        <LandingModels />
        <LandingDeploy />
        <LandingSecurity />
        <LandingCommunity />
      </div>
      <LandingFooter />
    </div>
  )
}
