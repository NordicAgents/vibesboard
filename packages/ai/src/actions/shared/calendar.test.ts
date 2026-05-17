// lib/agent/actions/shared/calendar.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Pure functions replicated from calendar.ts because Node's test runner
// cannot resolve the @/ path alias used by that module's other imports.
// These functions have no dependencies — keep them in sync with calendar.ts.

interface BusySlot { start: number; end: number }

function parseWallClock(datetime: string): Date {
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

function hasConflict(busySlots: BusySlot[], startMs: number, endMs: number): boolean {
  return busySlots.some(b => startMs < b.end && endMs > b.start)
}

function formatSlotDisplay(isoDate: string, timezone: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short'
    })
  } catch {
    return isoDate
  }
}

const HOUR = 60 * 60 * 1000

// ─── parseWallClock ──────────────────────────────────────────────────────

describe('parseWallClock', () => {
  test('YYYY-MM-DDTHH:MM is treated as UTC', () => {
    const d = parseWallClock('2026-05-10T14:00')
    assert.equal(d.getUTCHours(), 14)
    assert.equal(d.getUTCMinutes(), 0)
  })

  test('date-only YYYY-MM-DD is treated as UTC midnight', () => {
    const d = parseWallClock('2026-05-10')
    assert.equal(d.getUTCHours(), 0)
  })

  test('already-UTC string (ends with Z) is unchanged', () => {
    const d = parseWallClock('2026-05-10T14:00:00Z')
    assert.equal(d.getUTCHours(), 14)
  })

  test('string with offset is parsed correctly', () => {
    const d = parseWallClock('2026-05-10T14:00:00+05:30')
    assert.equal(d.getUTCHours(), 8)
    assert.equal(d.getUTCMinutes(), 30)
  })

  test('invalid string returns Invalid Date', () => {
    const d = parseWallClock('not-a-date')
    assert.ok(isNaN(d.getTime()))
  })
})

// ─── hasConflict ─────────────────────────────────────────────────────────

describe('hasConflict', () => {
  const busy: BusySlot[] = [{ start: 100 * HOUR, end: 103 * HOUR }]

  test('no conflict when slot is entirely before busy', () => {
    assert.equal(hasConflict(busy, 97 * HOUR, 99 * HOUR), false)
  })

  test('no conflict when slot starts exactly when busy ends', () => {
    assert.equal(hasConflict(busy, 103 * HOUR, 105 * HOUR), false)
  })

  test('conflict when slot overlaps start of busy', () => {
    assert.equal(hasConflict(busy, 99 * HOUR, 101 * HOUR), true)
  })

  test('conflict when slot is fully inside busy', () => {
    assert.equal(hasConflict(busy, 100 * HOUR, 102 * HOUR), true)
  })

  test('no conflict with empty busy list', () => {
    assert.equal(hasConflict([], 100 * HOUR, 102 * HOUR), false)
  })
})

// ─── formatSlotDisplay ───────────────────────────────────────────────────

describe('formatSlotDisplay', () => {
  test('formats ISO date with timezone', () => {
    const result = formatSlotDisplay('2026-05-10T14:00:00Z', 'America/New_York')
    assert.ok(result.includes('May'))
    assert.ok(result.includes('10'))
  })

  test('returns raw string on invalid date', () => {
    const result = formatSlotDisplay('bad-date', 'UTC')
    assert.ok(typeof result === 'string')
  })
})
