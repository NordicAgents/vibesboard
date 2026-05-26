import test from 'node:test'
import assert from 'node:assert/strict'

import {
  findOverlappingCalendarEvents,
  formatMultiResourceAvailability
} from './availability.ts'

test('findOverlappingCalendarEvents treats all-day checkout as exclusive', () => {
  const events = [
    {
      id: 'previous',
      summary: 'Previous Guest',
      start: '2026-05-01',
      end: '2026-05-03'
    },
    {
      id: 'overlap',
      summary: 'Current Guest',
      start: '2026-05-04',
      end: '2026-05-06'
    }
  ]

  const overlaps = findOverlappingCalendarEvents(
    events,
    '2026-05-03',
    '2026-05-05'
  )

  assert.deepEqual(
    overlaps.map(event => event.id),
    ['overlap']
  )
})

test('formatMultiResourceAvailability lists each room status', () => {
  const output = formatMultiResourceAvailability({
    startDatetime: '2026-05-03T00:00',
    endDatetime: '2026-05-05T00:00',
    timezone: 'Asia/Kolkata',
    results: [
      { resourceName: 'Room 1', available: true },
      { resourceName: 'Room 2', available: false },
      { resourceName: 'Room 3', available: true }
    ]
  })

  assert.match(output, /Room 1: available/)
  assert.match(output, /Room 2: unavailable/)
  assert.match(output, /Room 3: available/)
})
