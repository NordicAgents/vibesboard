import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LANDING_SHOWCASE_HEADING,
  LANDING_SHOWCASE_STEPS
} from './landing-showcase-copy.ts'

test('how it works heading explains the real customer-message outcome', () => {
  assert.equal(
    LANDING_SHOWCASE_HEADING,
    'Turn DMs into bookings, answers, and follow-ups - without doing the back-and-forth.'
  )
  assert.doesNotMatch(
    LANDING_SHOWCASE_HEADING,
    /vibe with people|get real insights/i
  )
  assert.match(LANDING_SHOWCASE_HEADING, /DMs|bookings|follow-ups/i)
})

test('how it works cards describe a concrete agent workflow', () => {
  assert.deepEqual(
    LANDING_SHOWCASE_STEPS.map(step => step.title),
    [
      'Train the Agent',
      'Connect the Inbox',
      'Agent Handles Replies',
      'Spot Demand Fast'
    ]
  )

  const copy = LANDING_SHOWCASE_STEPS.map(
    step => `${step.category} ${step.description}`
  ).join(' ')

  assert.match(copy, /services|tone|FAQs|booking rules/i)
  assert.match(copy, /WhatsApp|Instagram/i)
  assert.match(copy, /qualifies leads|books slots|follows up/i)
  assert.match(copy, /drop off|better answer/i)
  assert.doesNotMatch(copy, /Record Vibes|Share & Vibe|authentic interactions/i)
})
