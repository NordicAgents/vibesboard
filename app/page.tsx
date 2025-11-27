import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AgentCreatorChat } from '@/components/agents/agent-creator-chat'
import { LandingHeader } from '@/components/landing/landing-header'
import { LandingHero } from '@/components/landing/landing-hero'
import { LandingShowcase } from '@/components/landing/landing-showcase'
import { LandingServices } from '@/components/landing/landing-services'
import { LandingAbout } from '@/components/landing/landing-about'
import { LandingFooter } from '@/components/landing/landing-footer'

export const runtime = 'nodejs'

export default async function IndexPage() {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return (
      <main className="min-h-screen bg-beige-bg text-black-primary selection:bg-black-primary selection:text-beige-bg dark:bg-background dark:text-foreground dark:selection:bg-white dark:selection:text-black">
        <LandingHeader />
        <LandingHero />
        <LandingShowcase />
        <LandingServices />
        <LandingAbout />
        <LandingFooter />
      </main>
    )
  }

  return <AgentCreatorChat />
}
