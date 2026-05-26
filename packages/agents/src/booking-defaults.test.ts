import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDirectBookingDraftConfig,
  detectDirectBookingIntent,
  getBookingConfigSummary,
  resolveAgentCreatorBookingConfig
} from './booking-defaults.ts'

test('createDirectBookingDraftConfig prepares disabled direct booking setup', () => {
  const config = createDirectBookingDraftConfig()

  assert.equal(config.enabled, false)
  assert.equal(config.mode, 'direct')
  assert.deepEqual(config.resources, [])
  assert.equal(config.eventTitleTemplate, '{guest_name} ({guest_count} guests)')
  assert.equal(config.eventTimeMode, 'all-day')
  assert.equal(config.overlapProtection, true)
})

test('detectDirectBookingIntent recognizes resort room booking management', () => {
  assert.equal(
    detectDirectBookingIntent(
      'The owner has a resort with 3 rooms, each with its own Google Calendar. The agent should check availability, book rooms, edit bookings, and cancel bookings.'
    ),
    true
  )
})

test('detectDirectBookingIntent ignores generic support agents', () => {
  assert.equal(
    detectDirectBookingIntent(
      'Build a friendly customer support agent for product FAQs and order questions.'
    ),
    false
  )
})

test('getBookingConfigSummary explains next setup step for empty direct booking config', () => {
  const summary = getBookingConfigSummary(createDirectBookingDraftConfig())

  assert.equal(summary, 'Direct booking setup needed: add room calendars')
})

test('resolveAgentCreatorBookingConfig falls back from resort booking instructions', () => {
  const config = resolveAgentCreatorBookingConfig({
    name: 'Resort Booking Manager',
    instructions:
      'Help the resort owner check availability, book rooms, edit bookings, and cancel reservations across three room calendars.',
    greetingText: 'What booking should we manage today?'
  })

  assert.deepEqual(config, createDirectBookingDraftConfig())
})
