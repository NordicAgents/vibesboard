import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBookingConfig } from '@vibesboard/contracts'
import {
  DIRECT_BOOKING_ANONYMOUS_WARNING,
  getDirectBookingAccessWarning
} from './direct-booking-access-warning.ts'

function bookingConfig(
  patch: Partial<AgentBookingConfig> = {}
): AgentBookingConfig {
  return {
    enabled: true,
    resources: [
      {
        id: 'resource-1',
        name: 'Glass Cabin',
        calendarConnectionId: 'conn-1',
        calendarId: 'calendar-1',
        calendarName: 'Glass Cabin Bookings',
        timezone: 'Europe/Dublin'
      }
    ],
    mode: 'direct',
    eventTitleTemplate: '{guest_name} ({guest_count} guests)',
    eventTimeMode: 'all-day',
    overlapProtection: true,
    ...patch
  }
}

test('returns warning for enabled direct booking with anonymous chat', () => {
  const warning = getDirectBookingAccessWarning(bookingConfig(), true)

  assert.deepEqual(warning, DIRECT_BOOKING_ANONYMOUS_WARNING)
})

test('returns no warning for enquiry booking with anonymous chat', () => {
  const warning = getDirectBookingAccessWarning(
    bookingConfig({ mode: 'enquiry' }),
    true
  )

  assert.equal(warning, null)
})

test('returns no warning for direct booking when anonymous chat is disabled', () => {
  const warning = getDirectBookingAccessWarning(bookingConfig(), false)

  assert.equal(warning, null)
})

test('returns no warning when booking is disabled', () => {
  const warning = getDirectBookingAccessWarning(
    bookingConfig({ enabled: false }),
    true
  )

  assert.equal(warning, null)
})
