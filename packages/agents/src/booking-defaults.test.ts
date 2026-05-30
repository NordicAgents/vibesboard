import { describe, it, expect } from 'vitest'

import {
  createDirectBookingDraftConfig,
  detectDirectBookingIntent,
  getBookingConfigSummary,
  resolveAgentCreatorBookingConfig
} from './booking-defaults.ts'

it('createDirectBookingDraftConfig prepares disabled direct booking setup', () => {
  const config = createDirectBookingDraftConfig()

  expect(config.enabled).toBe(false)
  expect(config.mode).toBe('direct')
  expect(config.resources).toEqual([])
  expect(config.eventTitleTemplate).toBe('{guest_name} ({guest_count} guests)')
  expect(config.eventTimeMode).toBe('all-day')
  expect(config.overlapProtection).toBe(true)
})

it('detectDirectBookingIntent recognizes resort room booking management', () => {
  expect(
    detectDirectBookingIntent(
      'The owner has a resort with 3 rooms, each with its own Google Calendar. The agent should check availability, book rooms, edit bookings, and cancel bookings.'
    )
  ).toBe(true)
})

it('detectDirectBookingIntent ignores generic support agents', () => {
  expect(
    detectDirectBookingIntent(
      'Build a friendly customer support agent for product FAQs and order questions.'
    )
  ).toBe(false)
})

it('getBookingConfigSummary explains next setup step for empty direct booking config', () => {
  const summary = getBookingConfigSummary(createDirectBookingDraftConfig())

  expect(summary).toBe('Direct booking setup needed: add room calendars')
})

it('resolveAgentCreatorBookingConfig falls back from resort booking instructions', () => {
  const config = resolveAgentCreatorBookingConfig({
    name: 'Resort Booking Manager',
    instructions:
      'Help the resort owner check availability, book rooms, edit bookings, and cancel reservations across three room calendars.',
    greetingText: 'What booking should we manage today?'
  })

  expect(config).toEqual(createDirectBookingDraftConfig())
})

describe('booking-defaults (expanded coverage)', () => {
  it('detectDirectBookingIntent requires BOTH a booking term and a resource term', () => {
    // booking term but no resource term
    expect(detectDirectBookingIntent('Please cancel my appointment')).toBe(false)
    // resource term but no booking term
    expect(detectDirectBookingIntent('We have a lovely villa by the sea')).toBe(
      false
    )
    // both present
    expect(detectDirectBookingIntent('book the cabin')).toBe(true)
  })

  it('detectDirectBookingIntent is case-insensitive', () => {
    expect(detectDirectBookingIntent('BOOK A ROOM')).toBe(true)
  })

  it('getBookingConfigSummary returns null for undefined config', () => {
    expect(getBookingConfigSummary(undefined)).toBe(null)
  })

  it('getBookingConfigSummary describes configured resources (singular vs plural)', () => {
    const oneResource = {
      ...createDirectBookingDraftConfig(),
      resources: [{} as never]
    }
    expect(getBookingConfigSummary(oneResource)).toBe(
      'Direct booking: 1 room calendar'
    )
    const twoResources = {
      ...createDirectBookingDraftConfig(),
      resources: [{} as never, {} as never]
    }
    expect(getBookingConfigSummary(twoResources)).toBe(
      'Direct booking: 2 room calendars'
    )
  })

  it('getBookingConfigSummary reports enquiry mode label', () => {
    const config = {
      ...createDirectBookingDraftConfig(),
      mode: 'enquiry' as const
    }
    expect(getBookingConfigSummary(config)).toBe(
      'Enquiry booking setup needed: add room calendars'
    )
  })

  it('resolveAgentCreatorBookingConfig returns undefined for non-booking agents', () => {
    expect(
      resolveAgentCreatorBookingConfig({
        name: 'FAQ Bot',
        instructions: 'Answer product questions about returns and shipping.',
        greetingText: 'How can I help?'
      })
    ).toBe(undefined)
  })

  it('resolveAgentCreatorBookingConfig passes through an explicit bookingConfig', () => {
    const existing = {
      ...createDirectBookingDraftConfig(),
      enabled: true
    }
    expect(
      resolveAgentCreatorBookingConfig({
        name: 'Anything',
        instructions: 'irrelevant',
        bookingConfig: existing
      })
    ).toBe(existing)
  })
})
