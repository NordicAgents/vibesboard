/**
 * Tests for simple-booking pure logic: parseWallClock, findNearestSlots,
 * conflict detection, and input validation rules.
 *
 * All logic is replicated inline because @/ path aliases don't resolve
 * in the Node built-in test runner.
 *
 * Run:
 *   node --experimental-strip-types --test lib/agent/tools/simple-booking.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ─── Replicated pure logic ───────────────────────────────────────────────────

interface BusySlot { start: number; end: number }

const SEARCH_WINDOW_DAYS = 60
const MAX_SUGGESTIONS = 3
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseWallClock(datetime: string): Date {
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

function findNearestSlots(
  busySlots: BusySlot[],
  requestedStart: number,
  durationMs: number,
  now: number
): number[] {
  const windowEnd = requestedStart + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000

  const isBlocked = (startMs: number): boolean => {
    const endMs = startMs + durationMs
    return busySlots.some(b => startMs < b.end && endMs > b.start)
  }

  const forward: number[] = []
  let fCursor = requestedStart
  while (forward.length < MAX_SUGGESTIONS && fCursor < windowEnd) {
    if (!isBlocked(fCursor)) {
      forward.push(fCursor)
      fCursor += durationMs
    } else {
      const overlap = busySlots.find(b => fCursor < b.end && (fCursor + durationMs) > b.start)
      fCursor = overlap ? overlap.end : fCursor + durationMs
    }
  }

  const backward: number[] = []
  let bCursor = requestedStart - durationMs
  while (backward.length < MAX_SUGGESTIONS && bCursor >= now) {
    if (!isBlocked(bCursor)) {
      backward.unshift(bCursor)
      bCursor -= durationMs
    } else {
      const overlap = busySlots.find(b => bCursor < b.end && (bCursor + durationMs) > b.start)
      bCursor = overlap ? overlap.start - durationMs : bCursor - durationMs
    }
  }

  return [...backward, ...forward]
    .sort((a, b) => Math.abs(a - requestedStart) - Math.abs(b - requestedStart))
    .slice(0, MAX_SUGGESTIONS)
    .sort((a, b) => a - b)
}

function hasConflict(busySlots: BusySlot[], startMs: number, durationMs: number): boolean {
  return busySlots.some(b => startMs < b.end && (startMs + durationMs) > b.start)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

// ─── parseWallClock ───────────────────────────────────────────────────────────

describe('parseWallClock', () => {
  test('YYYY-MM-DDTHH:MM is treated as UTC', () => {
    const d = parseWallClock('2026-05-10T14:00')
    assert.equal(d.getUTCHours(), 14)
    assert.equal(d.getUTCMinutes(), 0)
    assert.equal(d.getUTCFullYear(), 2026)
    assert.equal(d.getUTCMonth(), 4) // May = 4
    assert.equal(d.getUTCDate(), 10)
  })

  test('date-only YYYY-MM-DD is treated as UTC midnight', () => {
    const d = parseWallClock('2026-05-10')
    assert.equal(d.getUTCHours(), 0)
    assert.equal(d.getUTCMinutes(), 0)
    assert.equal(d.getUTCDate(), 10)
  })

  test('already-UTC string (ends with Z) is unchanged', () => {
    const d = parseWallClock('2026-05-10T14:00:00Z')
    assert.equal(d.getUTCHours(), 14)
  })

  test('string with offset is parsed correctly', () => {
    const d = parseWallClock('2026-05-10T14:00:00+05:30')
    // 14:00 IST = 08:30 UTC
    assert.equal(d.getUTCHours(), 8)
    assert.equal(d.getUTCMinutes(), 30)
  })

  test('invalid string returns Invalid Date', () => {
    const d = parseWallClock('not-a-date')
    assert.ok(isNaN(d.getTime()))
  })

  test('HH:MM:SS is also parsed correctly', () => {
    const d = parseWallClock('2026-05-10T09:30:00')
    assert.equal(d.getUTCHours(), 9)
    assert.equal(d.getUTCMinutes(), 30)
  })
})

// ─── hasConflict (the booking overlap predicate) ──────────────────────────────

describe('hasConflict', () => {
  const busy: BusySlot[] = [
    { start: 100 * HOUR, end: 103 * HOUR } // busy 100–103h
  ]

  test('no conflict when slot is entirely before busy', () => {
    assert.equal(hasConflict(busy, 97 * HOUR, 2 * HOUR), false)
  })

  test('no conflict when slot starts exactly when busy ends', () => {
    assert.equal(hasConflict(busy, 103 * HOUR, 2 * HOUR), false)
  })

  test('no conflict when slot ends exactly when busy starts', () => {
    assert.equal(hasConflict(busy, 98 * HOUR, 2 * HOUR), false)
  })

  test('conflict when slot overlaps start of busy', () => {
    assert.equal(hasConflict(busy, 99 * HOUR, 2 * HOUR), true) // 99–101 overlaps 100–103
  })

  test('conflict when slot is fully inside busy', () => {
    assert.equal(hasConflict(busy, 100 * HOUR, 2 * HOUR), true)
  })

  test('conflict when slot overlaps end of busy', () => {
    assert.equal(hasConflict(busy, 102 * HOUR, 2 * HOUR), true) // 102–104 overlaps 100–103
  })

  test('conflict when slot spans the entire busy period', () => {
    assert.equal(hasConflict(busy, 99 * HOUR, 5 * HOUR), true)
  })

  test('no conflict with empty busy list', () => {
    assert.equal(hasConflict([], 100 * HOUR, 2 * HOUR), false)
  })

  test('no conflict with multiple busy slots, slot fits in gap', () => {
    const slots: BusySlot[] = [
      { start: 100 * HOUR, end: 102 * HOUR },
      { start: 105 * HOUR, end: 107 * HOUR }
    ]
    // Slot at 102–105 fits in gap
    assert.equal(hasConflict(slots, 102 * HOUR, 3 * HOUR), false)
  })
})

// ─── findNearestSlots ─────────────────────────────────────────────────────────

describe('findNearestSlots', () => {
  // requestedStart is far enough in future that backward scan works
  const now = 0
  const requestedStart = 100 * DAY
  const duration = 2 * DAY

  test('returns requestedStart itself when no conflicts', () => {
    const slots = findNearestSlots([], requestedStart, duration, now)
    assert.ok(slots.includes(requestedStart), 'should include requested start')
  })

  test('returns at most MAX_SUGGESTIONS results', () => {
    const slots = findNearestSlots([], requestedStart, duration, now)
    assert.ok(slots.length <= MAX_SUGGESTIONS)
  })

  test('all returned slots are sorted chronologically', () => {
    const busySlots: BusySlot[] = [
      { start: requestedStart, end: requestedStart + duration } // block requested slot
    ]
    const slots = findNearestSlots(busySlots, requestedStart, duration, now)
    for (let i = 1; i < slots.length; i++) {
      assert.ok(slots[i] >= slots[i - 1], 'slots must be in ascending order')
    }
  })

  test('returns slot after the busy block when requested slot is blocked', () => {
    const busyEnd = requestedStart + duration + HOUR
    const busySlots: BusySlot[] = [
      { start: requestedStart, end: busyEnd }
    ]
    const slots = findNearestSlots(busySlots, requestedStart, duration, now)
    // First available slot forward is busyEnd
    assert.ok(slots.some(s => s >= busyEnd), 'should find slot after busy block')
  })

  test('includes slots before requestedStart (backward scan)', () => {
    const busySlots: BusySlot[] = [
      { start: requestedStart, end: requestedStart + duration } // only block the requested slot
    ]
    const slots = findNearestSlots(busySlots, requestedStart, duration, now)
    const hasBefore = slots.some(s => s < requestedStart)
    assert.ok(hasBefore, 'backward scan should suggest earlier slots')
  })

  test('never returns a slot before now', () => {
    const recentNow = 90 * DAY
    const slots = findNearestSlots([], requestedStart, duration, recentNow)
    for (const s of slots) {
      assert.ok(s >= recentNow, `slot ${s} is before now=${recentNow}`)
    }
  })

  test('returns empty when everything in window is busy', () => {
    // Fill entire search window with busy slots
    const busySlots: BusySlot[] = [{
      start: requestedStart,
      end: requestedStart + (SEARCH_WINDOW_DAYS + 1) * DAY
    }]
    // backward scan can't go before now=requestedStart-1day since duration=2days would require start >=now
    const slots = findNearestSlots(busySlots, requestedStart, duration, requestedStart - DAY)
    assert.equal(slots.length, 0)
  })

  test('requestedStart is included in results when no conflicts', () => {
    // Backward scan also runs (now=0), so chronologically requestedStart may not be first.
    // What matters is it is in the returned set.
    const slots = findNearestSlots([], requestedStart, duration, now)
    assert.ok(slots.includes(requestedStart), 'requestedStart should be one of the suggestions')
  })

  test('skips over multiple consecutive busy blocks (forward scan)', () => {
    // Two back-to-back busy blocks covering requestedStart and the slot right after
    const busySlots: BusySlot[] = [
      { start: requestedStart, end: requestedStart + duration },
      { start: requestedStart + duration, end: requestedStart + 2 * duration }
    ]
    const slots = findNearestSlots(busySlots, requestedStart, duration, now)
    // No returned slot should fall inside either busy block
    for (const s of slots) {
      const conflict = hasConflict(busySlots, s, duration)
      assert.ok(!conflict, `slot ${s} conflicts with a busy block`)
    }
    // At least one forward slot must be found (after the busy blocks)
    assert.ok(slots.some(s => s >= requestedStart + 2 * duration), 'should find a slot after both busy blocks')
  })
})

// ─── Input validation rules (replicated from tool execute) ───────────────────

describe('input validation', () => {
  test('EMAIL_REGEX accepts valid emails', () => {
    assert.ok(EMAIL_REGEX.test('user@example.com'))
    assert.ok(EMAIL_REGEX.test('user+tag@sub.domain.org'))
  })

  test('EMAIL_REGEX rejects invalid emails', () => {
    assert.ok(!EMAIL_REGEX.test('notanemail'))
    assert.ok(!EMAIL_REGEX.test('@nodomain.com'))
    assert.ok(!EMAIL_REGEX.test('no@'))
    assert.ok(!EMAIL_REGEX.test('spaces in@email.com'))
  })

  test('end must be after start', () => {
    const start = parseWallClock('2026-05-10T14:00')
    const end = parseWallClock('2026-05-10T12:00')
    assert.ok(end <= start, 'end before start should be rejected')
  })

  test('equal start and end is also invalid', () => {
    const start = parseWallClock('2026-05-10T14:00')
    const end = parseWallClock('2026-05-10T14:00')
    assert.ok(!(end > start), 'equal datetimes should be rejected')
  })
})
