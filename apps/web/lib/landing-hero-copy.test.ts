import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import {
  LANDING_HERO_BADGES,
  LANDING_HERO_COMMAND,
  LANDING_HERO_HEADING_HIGHLIGHT,
  LANDING_HERO_HEADING_LEAD,
  LANDING_HERO_PRIMARY_CTA,
  LANDING_HERO_SECONDARY_CTA,
  LANDING_HERO_SUBHEADING
} from './landing-hero-copy.ts'

const README = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'README.md'),
  'utf8'
)

describe('landing hero copy', () => {
  it('leads with a concise promise, not with a mood', () => {
    const heading = `${LANDING_HERO_HEADING_LEAD} ${LANDING_HERO_HEADING_HIGHLIGHT}`
    expect(heading).toBe('Know the real vibe of your customers.')
    expect(heading).not.toMatch(/vibing with people/i)
  })

  it('makes ownership and business scalability explicit', () => {
    expect(LANDING_HERO_SUBHEADING).toBe(
      'Your own agentic platform to build, deploy, and scale agents that vibe with people.'
    )
  })

  it('badges the two facts a self-hoster checks first', () => {
    expect(LANDING_HERO_BADGES).toEqual(['Self-hosted', 'Bring your own model'])
  })

  it('sends the primary CTA to the quickstart, not to a signup wall', () => {
    expect(LANDING_HERO_PRIMARY_CTA.href).toBe('#quickstart')
    // Docs are served from this app, same tab, same domain — not a GitHub
    // file link — so search ranking and analytics compound on the site.
    expect(LANDING_HERO_SECONDARY_CTA.href).toBe('/docs')
    expect(LANDING_HERO_SECONDARY_CTA.external).toBeFalsy()
  })

  it('shows commands that exist in the README quickstart', () => {
    const lines = LANDING_HERO_COMMAND.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(README, line).toContain(line)
    }
  })
})
