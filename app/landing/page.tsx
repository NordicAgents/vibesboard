import { LandingHeader } from '@/components/landing/landing-header'
import { LandingHero } from '@/components/landing/landing-hero'
import { LandingShowcase } from '@/components/landing/landing-showcase'
import { LandingServices } from '@/components/landing/landing-services'
import { LandingAbout } from '@/components/landing/landing-about'
import { LandingFooter } from '@/components/landing/landing-footer'

export default function LandingPage() {
    return (
        <div className="h-full overflow-y-auto bg-beige-bg text-black-primary selection:bg-black-primary selection:text-beige-bg">
            <LandingHeader />
            <LandingHero />
            <LandingShowcase />
            <LandingServices />
            <LandingAbout />
            <LandingFooter />
        </div>
    )
}
