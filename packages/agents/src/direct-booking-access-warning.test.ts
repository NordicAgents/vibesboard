import { it, expect } from 'vitest'
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

it('returns warning for enabled direct booking with anonymous chat', () => {
  const warning = getDirectBookingAccessWarning(bookingConfig(), true)

  expect(warning).toEqual(DIRECT_BOOKING_ANONYMOUS_WARNING)
})

it('returns no warning for enquiry booking with anonymous chat', () => {
  const warning = getDirectBookingAccessWarning(
    bookingConfig({ mode: 'enquiry' }),
    true
  )

  expect(warning).toBe(null)
})

it('returns no warning for direct booking when anonymous chat is disabled', () => {
  const warning = getDirectBookingAccessWarning(bookingConfig(), false)

  expect(warning).toBe(null)
})

it('returns no warning when booking is disabled', () => {
  const warning = getDirectBookingAccessWarning(
    bookingConfig({ enabled: false }),
    true
  )

  expect(warning).toBe(null)
})
