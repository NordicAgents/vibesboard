import Link from 'next/link'
import { Check } from 'lucide-react'
import { auth } from '@/auth'
import { getAllPlanTemplates, type PlanDefinition } from '@/lib/plans'

export const metadata = {
  title: 'Pricing — VibeAgent',
  description:
    'Simple, transparent pricing for VibeAgent. Start free, scale as you grow.',
}

function formatPrice(plan: PlanDefinition): { price: string; suffix: string } {
  if (plan.pricePerSeat) {
    return { price: `$${(plan.pricePerSeat / 100).toFixed(0)}`, suffix: '/seat/month' }
  }
  if (plan.price === 0) {
    return { price: '$0', suffix: '/month' }
  }
  return { price: `$${(plan.price / 100).toFixed(0)}`, suffix: '/month' }
}

function getPlanDescription(planId: string): string {
  const descriptions: Record<string, string> = {
    free: 'Perfect for trying things out',
    pro: 'For creators and small businesses',
    team: 'For collaborative teams',
  }
  return descriptions[planId] ?? ''
}

function getPlanFeatures(plan: PlanDefinition): string[] {
  const features: string[] = ['Unlimited agents']

  if (plan.includedMessagesPerSeat) {
    features.push(`${plan.includedMessagesPerSeat.toLocaleString()} messages/seat/month`)
  } else if (plan.includedMessages > 0) {
    features.push(`${plan.includedMessages.toLocaleString()} messages/month`)
  }

  if (plan.featureFlags.includes('AGENT_LINKS')) features.push('Agent links')
  if (plan.featureFlags.includes('EMBED_WIDGET')) features.push('Embed widget')
  if (plan.featureFlags.includes('AGENT_NOTIFICATIONS')) features.push('Agent notifications')
  if (plan.featureFlags.includes('GOOGLE_REVIEW')) features.push('Google Review integration')
  if (plan.featureFlags.includes('INBOX')) features.push('Inbox')
  if (plan.featureFlags.includes('WHATSAPP_INBOX')) features.push('WhatsApp & Instagram Inbox')
  if (plan.featureFlags.includes('CHATWOOT')) features.push('Chatwoot integration')
  if (plan.featureFlags.includes('TEAM_COLLABORATION')) features.push('Team collaboration')
  if (plan.featureFlags.includes('CUSTOM_BRANDING')) features.push('Custom branding')

  if (plan.overageRate > 0) {
    features.push(`$${(plan.overageRate / 100).toFixed(3)}/msg overage`)
  }

  if (plan.minSeats) {
    features.push(`Min ${plan.minSeats} seats`)
  }

  return features
}

export default async function PricingPage() {
  const session = await auth()
  const isLoggedIn = Boolean(session?.user?.id)

  const allPlans = await getAllPlanTemplates()
  const displayPlans = allPlans
    .filter(p => p.id !== 'enterprise')
    .sort((a, b) => {
      const order = ['free', 'pro', 'team']
      return order.indexOf(a.id) - order.indexOf(b.id)
    })
    .map(plan => {
      const { price, suffix } = formatPrice(plan)
      return {
        id: plan.id,
        name: plan.name,
        price,
        priceSuffix: suffix,
        description: getPlanDescription(plan.id),
        features: getPlanFeatures(plan),
        cta: plan.id === 'free' ? 'Get Started Free' : `Upgrade to ${plan.name}`,
        ctaHref: '/sign-up',
        ctaAuthHref: plan.id === 'free' ? '/agents' : '/settings/tenant/billing',
        highlight: plan.id === 'pro',
      }
    })

  return (
    <div className="min-h-screen bg-[#f7f7f5] dark:bg-[#222f30]">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="font-serif text-4xl font-bold text-[#222f30] dark:text-[#f5f8f7] sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-[#6f7f80]">
            Start free with 100 messages. Upgrade when you need more.
            All plans include unlimited agents.
          </p>
        </div>

        {/* Plan Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {displayPlans.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-6 transition-all ${
                plan.highlight
                  ? 'border-accent-orange bg-[#fdf8f5] shadow-lg dark:bg-[#2a2420]'
                  : 'border-[#e4e3e3] bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425]'
              }`}
            >
              {plan.highlight && (
                <div className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-accent-orange">
                  Most Popular
                </div>
              )}

              <h2 className="font-serif text-xl font-semibold text-[#222f30] dark:text-[#f5f8f7]">
                {plan.name}
              </h2>
              <p className="mt-1 text-sm text-[#6f7f80]">
                {plan.description}
              </p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-serif text-4xl font-bold text-[#222f30] dark:text-[#f5f8f7]">
                  {plan.price}
                </span>
                <span className="text-sm text-[#6f7f80]">
                  {plan.priceSuffix}
                </span>
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-orange" />
                    <span className="text-sm text-[#445e5f] dark:text-[#9d9790]">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href={isLoggedIn ? plan.ctaAuthHref : plan.ctaHref}
                className={`mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  plan.highlight
                    ? 'bg-accent-orange text-white hover:bg-accent-warm'
                    : 'border border-[#e4e3e3] bg-white text-[#222f30] hover:bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] dark:text-[#f5f8f7] dark:hover:bg-[#283839]'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Enterprise CTA */}
        <div className="mt-12 rounded-2xl border border-[#e4e3e3] bg-[#f5f8f7] p-8 text-center dark:border-[#344348] dark:bg-[#192425]">
          <h2 className="font-serif text-2xl font-semibold text-[#222f30] dark:text-[#f5f8f7]">
            Enterprise
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#6f7f80]">
            Need custom message limits, SSO, SLA, or dedicated support?
            Let&apos;s talk.
          </p>
          <Link
            href="mailto:hello@vibeagent.com"
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-[#e4e3e3] bg-white px-6 py-2.5 text-sm font-medium text-[#222f30] transition-colors hover:bg-[#f5f8f7] dark:border-[#344348] dark:bg-[#192425] dark:text-[#f5f8f7] dark:hover:bg-[#283839]"
          >
            Contact Sales
          </Link>
        </div>
      </div>
    </div>
  )
}
