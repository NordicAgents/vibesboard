import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  LANDING_SERVICES_HEADING,
  LANDING_SERVICES_ITEMS
} from './landing-services-copy.ts'

test('capabilities heading speaks to business outcomes', () => {
  assert.equal(
    LANDING_SERVICES_HEADING,
    'Built for businesses that win by replying faster.'
  )
  assert.match(LANDING_SERVICES_HEADING, /businesses|replying faster/i)
})

test('capabilities list matches the current customer-conversation business goal', () => {
  assert.deepEqual(
    LANDING_SERVICES_ITEMS.map(item => item.title),
    [
      'Reply Before They Bounce',
      'Capture Every Lead',
      'Book More Appointments',
      'Know What Customers Want'
    ]
  )

  const copy = LANDING_SERVICES_ITEMS.map(item => item.description).join(' ')

  assert.match(copy, /WhatsApp|Instagram/i)
  assert.match(copy, /qualify|names|needs/i)
  assert.match(copy, /slots|reminders|quiet/i)
  assert.match(copy, /people ask|deals stall|answers/i)
  assert.doesNotMatch(
    copy,
    /unique personalities|all vibes|authentic reactions|community/i
  )
})

test('capabilities include relevant generated business visuals', () => {
  assert.deepEqual(
    LANDING_SERVICES_ITEMS.map(item => item.image),
    [
      '/images/landing/capabilities/reply-before-they-bounce.png',
      '/images/landing/capabilities/capture-every-lead.png',
      '/images/landing/capabilities/book-more-appointments.png',
      '/images/landing/capabilities/know-what-customers-want.png'
    ]
  )

  for (const item of LANDING_SERVICES_ITEMS) {
    assert.match(item.imageAlt, /VibeAgent capability visual/i)
    assert.equal(
      existsSync(join(process.cwd(), 'public', item.image.replace(/^\//, ''))),
      true
    )
  }
})
