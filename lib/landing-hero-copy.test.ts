import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LANDING_HERO_CONVERSATION,
  LANDING_HERO_TAGLINE
} from './landing-hero-copy.ts'

test('landing hero tagline focuses on agent-led time savings', () => {
  assert.equal(LANDING_HERO_TAGLINE, 'Let your agent talk. Get your time back.')
  assert.doesNotMatch(LANDING_HERO_TAGLINE, /WhatsApp|Instagram|AI-Powered/i)
  assert.match(LANDING_HERO_TAGLINE, /agent/i)
  assert.match(LANDING_HERO_TAGLINE, /time/i)
})

test('landing hero conversation shows a real customer booking handled by the agent', () => {
  const copy = LANDING_HERO_CONVERSATION.map(message => message.text).join(' ')

  assert.equal(LANDING_HERO_CONVERSATION.length, 4)
  assert.deepEqual(
    LANDING_HERO_CONVERSATION.map(message => message.role),
    ['customer', 'agent', 'customer', 'agent']
  )
  assert.match(copy, /book|consultation|confirmation|calendar/i)
  assert.doesNotMatch(
    copy,
    /ready to handle customer conversations|auto-reply on WhatsApp|set it up/i
  )
})
