import { describe, it, expect } from 'vitest'

import {
  LANDING_HERO_CONVERSATION,
  LANDING_HERO_TAGLINE
} from './landing-hero-copy.ts'

describe('landing hero copy', () => {
  it('landing hero tagline focuses on agent-led time savings', () => {
    expect(LANDING_HERO_TAGLINE).toBe(
      'Let your agent talk. Get your time back.'
    )
    expect(LANDING_HERO_TAGLINE).not.toMatch(/WhatsApp|Instagram|AI-Powered/i)
    expect(LANDING_HERO_TAGLINE).toMatch(/agent/i)
    expect(LANDING_HERO_TAGLINE).toMatch(/time/i)
  })

  it('landing hero conversation shows a real customer booking handled by the agent', () => {
    const copy = LANDING_HERO_CONVERSATION.map(message => message.text).join(' ')

    expect(LANDING_HERO_CONVERSATION.length).toBe(4)
    expect(LANDING_HERO_CONVERSATION.map(message => message.role)).toEqual([
      'customer',
      'agent',
      'customer',
      'agent'
    ])
    expect(copy).toMatch(/book|consultation|confirmation|calendar/i)
    expect(copy).not.toMatch(
      /ready to handle customer conversations|auto-reply on WhatsApp|set it up/i
    )
  })
})
