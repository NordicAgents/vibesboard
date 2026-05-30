import { describe, it, expect } from 'vitest'

import {
  LANDING_ABOUT_HEADING,
  LANDING_ABOUT_PARAGRAPHS
} from './landing-about-copy.ts'

describe('landing about copy', () => {
  it('about section headline is business-focused and concrete', () => {
    expect(LANDING_ABOUT_HEADING).toBe(
      'Built so customers never wait on your inbox.'
    )
    expect(LANDING_ABOUT_HEADING).toMatch(/customers|inbox/i)
    expect(LANDING_ABOUT_HEADING).not.toMatch(/authentic human connection|vibe/i)
  })

  it('about section copy explains the current VibeAgent business goal', () => {
    const copy = LANDING_ABOUT_PARAGRAPHS.join(' ')

    expect(LANDING_ABOUT_PARAGRAPHS.length).toBe(2)
    expect(copy).toMatch(/WhatsApp|Instagram/i)
    expect(copy).toMatch(/answered questions|qualified leads|booked appointments/i)
    expect(copy).toMatch(/pricing|availability|handoff rules/i)
    expect(copy).toMatch(
      /conversation stays visible|follow-up status|customers keep asking/i
    )
    expect(copy).not.toMatch(
      /vibe with people|unique personalities|real vibe|sentiment|authentic reactions/i
    )
  })
})
