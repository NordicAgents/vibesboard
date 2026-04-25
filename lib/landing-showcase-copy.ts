export interface LandingShowcaseStep {
  id: number
  title: string
  category: string
  description: string
  image: string
}

export const LANDING_SHOWCASE_HEADING =
  'Turn DMs into bookings, answers, and follow-ups - without doing the back-and-forth.'

export const LANDING_SHOWCASE_STEPS: LandingShowcaseStep[] = [
  {
    id: 1,
    title: 'Train the Agent',
    category: 'Setup',
    description:
      'Add your services, tone, FAQs, and booking rules so every reply sounds like your team.',
    image: '/images/landing/updated-landing/Build Agents.png'
  },
  {
    id: 2,
    title: 'Connect the Inbox',
    category: 'Channels',
    description:
      'Bring WhatsApp and Instagram messages into one flow, ready for the agent to handle.',
    image: '/images/landing/updated-landing/share.png'
  },
  {
    id: 3,
    title: 'Agent Handles Replies',
    category: 'Save Time',
    description:
      'It answers repeat questions, qualifies leads, books slots, and follows up when people go quiet.',
    image: '/images/landing/updated-landing/record.png'
  },
  {
    id: 4,
    title: 'Spot Demand Fast',
    category: 'Insights',
    description:
      'See what customers ask for most, where they drop off, and what needs a better answer.',
    image: '/images/landing/updated-landing/Analysis.png'
  }
]
