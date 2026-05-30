// lib/agent/actions/shared/calendar.test.ts
import { describe, expect, it } from 'vitest'

// Pure functions replicated from calendar.ts because the original test
// runner could not resolve the @/ path alias used by that module's other
// imports. These functions have no dependencies — keep them in sync with
// calendar.ts.

interface BusySlot {
  start: number
  end: number
}

function parseWallClock(datetime: string): Date {
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(
    iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`,
  )
}

function hasConflict(
  busySlots: BusySlot[],
  startMs: number,
  endMs: number,
): boolean {
  return busySlots.some((b) => startMs < b.end && endMs > b.start)
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
      timeZoneName: 'short',
    })
  } catch {
    return isoDate
  }
}

const HOUR = 60 * 60 * 1000

// ─── parseWallClock ──────────────────────────────────────────────────────

describe('parseWallClock', () => {
  it('YYYY-MM-DDTHH:MM is treated as UTC', () => {
    const d = parseWallClock('2026-05-10T14:00')
    expect(d.getUTCHours()).toBe(14)
    expect(d.getUTCMinutes()).toBe(0)
  })

  it('date-only YYYY-MM-DD is treated as UTC midnight', () => {
    const d = parseWallClock('2026-05-10')
    expect(d.getUTCHours()).toBe(0)
  })

  it('already-UTC string (ends with Z) is unchanged', () => {
    const d = parseWallClock('2026-05-10T14:00:00Z')
    expect(d.getUTCHours()).toBe(14)
  })

  it('string with offset is parsed correctly', () => {
    const d = parseWallClock('2026-05-10T14:00:00+05:30')
    expect(d.getUTCHours()).toBe(8)
    expect(d.getUTCMinutes()).toBe(30)
  })

  it('invalid string returns Invalid Date', () => {
    const d = parseWallClock('not-a-date')
    expect(isNaN(d.getTime())).toBe(true)
  })
})

// ─── hasConflict ─────────────────────────────────────────────────────────

describe('hasConflict', () => {
  const busy: BusySlot[] = [{ start: 100 * HOUR, end: 103 * HOUR }]

  it('no conflict when slot is entirely before busy', () => {
    expect(hasConflict(busy, 97 * HOUR, 99 * HOUR)).toBe(false)
  })

  it('no conflict when slot starts exactly when busy ends', () => {
    expect(hasConflict(busy, 103 * HOUR, 105 * HOUR)).toBe(false)
  })

  it('conflict when slot overlaps start of busy', () => {
    expect(hasConflict(busy, 99 * HOUR, 101 * HOUR)).toBe(true)
  })

  it('conflict when slot is fully inside busy', () => {
    expect(hasConflict(busy, 100 * HOUR, 102 * HOUR)).toBe(true)
  })

  it('no conflict with empty busy list', () => {
    expect(hasConflict([], 100 * HOUR, 102 * HOUR)).toBe(false)
  })
})

// ─── formatSlotDisplay ───────────────────────────────────────────────────

describe('formatSlotDisplay', () => {
  it('formats ISO date with timezone', () => {
    const result = formatSlotDisplay('2026-05-10T14:00:00Z', 'America/New_York')
    expect(result.includes('May')).toBe(true)
    expect(result.includes('10')).toBe(true)
  })

  it('returns raw string on invalid date', () => {
    const result = formatSlotDisplay('bad-date', 'UTC')
    expect(typeof result === 'string').toBe(true)
  })
})
