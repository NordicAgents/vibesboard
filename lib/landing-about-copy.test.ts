import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LANDING_ABOUT_HEADING,
  LANDING_ABOUT_PARAGRAPHS
} from './landing-about-copy.ts'

test('about section headline is business-focused and concrete', () => {
  assert.equal(
    LANDING_ABOUT_HEADING,
    'Built so customers never wait on your inbox.'
  )
  assert.match(LANDING_ABOUT_HEADING, /customers|inbox/i)
  assert.doesNotMatch(
    LANDING_ABOUT_HEADING,
    /authentic human connection|vibe/i
  )
})

test('about section copy explains the current VibeAgent business goal', () => {
  const copy = LANDING_ABOUT_PARAGRAPHS.join(' ')

  assert.equal(LANDING_ABOUT_PARAGRAPHS.length, 2)
  assert.match(copy, /WhatsApp|Instagram/i)
  assert.match(copy, /answered questions|qualified leads|booked appointments/i)
  assert.match(copy, /pricing|availability|handoff rules/i)
  assert.match(copy, /conversation stays visible|follow-up status|customers keep asking/i)
  assert.doesNotMatch(
    copy,
    /vibe with people|unique personalities|real vibe|sentiment|authentic reactions/i
  )
})
