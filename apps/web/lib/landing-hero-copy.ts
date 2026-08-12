import { LANDING_LINKS } from './landing-links'

export interface LandingCta {
  label: string
  href: string
  external?: boolean
}

/** Chips above the headline: the three facts a self-hoster checks first. */
export const LANDING_HERO_BADGES = [
  'MIT licensed',
  'Self-hosted',
  'Bring your own model'
]

export const LANDING_HERO_HEADING_LEAD = 'The agent platform'
export const LANDING_HERO_HEADING_HIGHLIGHT = 'you host yourself.'

export const LANDING_HERO_SUBHEADING =
  'One agent, every channel. Grounded in your data, connected to your tools, running on your servers.'

export const LANDING_HERO_PRIMARY_CTA: LandingCta = {
  label: 'Start self-hosting',
  href: '#quickstart'
}

export const LANDING_HERO_SECONDARY_CTA: LandingCta = {
  label: 'Read the docs',
  href: LANDING_LINKS.docs,
  external: true
}

/**
 * The hero terminal. Three lines lifted from the README quickstart — enough to
 * prove the project runs locally without turning the hero into a manual.
 */
export const LANDING_HERO_COMMAND = [
  'git clone https://github.com/NordicAgents/vibesboard.git',
  'cd vibeagent',
  'bun install',
  'bun run db:setup'
].join('\n')
