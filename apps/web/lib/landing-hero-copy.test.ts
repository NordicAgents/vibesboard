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
  it('leads with what the project is, not with a mood', () => {
    const heading = `${LANDING_HERO_HEADING_LEAD} ${LANDING_HERO_HEADING_HIGHLIGHT}`
    expect(heading).toMatch(/agent platform/i)
    expect(heading).toMatch(/host yourself/i)
    expect(heading).not.toMatch(/vibing with people/i)
  })

  it('keeps the promise channel-agnostic and self-hosted', () => {
    expect(LANDING_HERO_SUBHEADING).toMatch(/every channel/i)
    expect(LANDING_HERO_SUBHEADING).toMatch(/your data/i)
    expect(LANDING_HERO_SUBHEADING).toMatch(/your servers/i)
    // Naming individual networks dates the copy every time one is added.
    expect(LANDING_HERO_SUBHEADING).not.toMatch(/WhatsApp|Instagram/i)
  })

  it('badges the three facts a self-hoster checks first', () => {
    expect(LANDING_HERO_BADGES).toEqual([
      'MIT licensed',
      'Self-hosted',
      'Bring your own model'
    ])
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
