import { describe, it, expect } from 'vitest'

import {
  LANDING_SHOWCASE_HEADING,
  LANDING_SHOWCASE_STEPS
} from './landing-showcase-copy.ts'

describe('landing showcase copy', () => {
  it('how it works heading explains the real customer-message outcome', () => {
    expect(LANDING_SHOWCASE_HEADING).toBe(
      'Turn DMs into bookings, answers, and follow-ups - without doing the back-and-forth.'
    )
    expect(LANDING_SHOWCASE_HEADING).not.toMatch(
      /vibe with people|get real insights/i
    )
    expect(LANDING_SHOWCASE_HEADING).toMatch(/DMs|bookings|follow-ups/i)
  })

  it('how it works cards describe a concrete agent workflow', () => {
    expect(LANDING_SHOWCASE_STEPS.map(step => step.title)).toEqual([
      'Train the Agent',
      'Connect the Inbox',
      'Agent Handles Replies',
      'Spot Demand Fast'
    ])

    const copy = LANDING_SHOWCASE_STEPS.map(
      step => `${step.category} ${step.description}`
    ).join(' ')

    expect(copy).toMatch(/services|tone|FAQs|booking rules/i)
    expect(copy).toMatch(/WhatsApp|Instagram/i)
    expect(copy).toMatch(/qualifies leads|books slots|follows up/i)
    expect(copy).toMatch(/drop off|better answer/i)
    expect(copy).not.toMatch(/Record Vibes|Share & Vibe|authentic interactions/i)
  })
})
