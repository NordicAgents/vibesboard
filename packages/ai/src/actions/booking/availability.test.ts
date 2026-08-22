import { describe, expect, it } from 'vitest'

import {
  findOverlappingCalendarEvents,
  formatMultiResourceAvailability,
} from './availability.ts'

it('findOverlappingCalendarEvents treats all-day checkout as exclusive', () => {
  const events = [
    {
      id: 'previous',
      summary: 'Previous Guest',
      start: '2026-05-01',
      end: '2026-05-03',
    },
    {
      id: 'overlap',
      summary: 'Current Guest',
      start: '2026-05-04',
      end: '2026-05-06',
    },
  ]

  const overlaps = findOverlappingCalendarEvents(events, '2026-05-03', '2026-05-05')

  expect(overlaps.map((event) => event.id)).toEqual(['overlap'])
})

it('formatMultiResourceAvailability lists each room status', () => {
  const output = formatMultiResourceAvailability({
    startDatetime: '2026-05-03T00:00',
    endDatetime: '2026-05-05T00:00',
    timezone: 'Asia/Kolkata',
    results: [
      { resourceName: 'Room 1', available: true },
      { resourceName: 'Room 2', available: false },
      { resourceName: 'Room 3', available: true },
    ],
  })

  expect(output).toMatch(/Room 1: available/)
  expect(output).toMatch(/Room 2: unavailable/)
  expect(output).toMatch(/Room 3: available/)
})
