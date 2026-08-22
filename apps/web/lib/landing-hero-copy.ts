import { LANDING_LINKS } from './landing-links'

export interface LandingCta {
  label: string
  href: string
  external?: boolean
}

/** Chips above the headline: the two facts a self-hoster checks first. */
export const LANDING_HERO_BADGES = ['Self-hosted', 'Bring your own model']

export const LANDING_HERO_HEADING_LEAD = 'Know the real'
export const LANDING_HERO_HEADING_HIGHLIGHT = 'vibe of your customers.'

export const LANDING_HERO_SUBHEADING =
  'Your own agentic platform to build, deploy, and scale agents that vibe with people.'

export const LANDING_HERO_PRIMARY_CTA: LandingCta = {
  label: 'Start self-hosting',
  href: '#quickstart'
}

export const LANDING_HERO_SECONDARY_CTA: LandingCta = {
  label: 'Read the docs',
  href: LANDING_LINKS.docs
}

/**
 * The hero terminal. Three lines lifted from the README quickstart — enough to
 * prove the project runs locally without turning the hero into a manual.
 */
export const LANDING_HERO_COMMAND = [
  'git clone https://github.com/NordicAgents/vibesboard.git',
  'cd vibesboard',
  'bun install',
  'bun run db:setup'
].join('\n')
