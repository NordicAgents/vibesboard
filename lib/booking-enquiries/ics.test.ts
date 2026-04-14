/**
 * Tests for the ICS generator used by simple booking.
 *
 * Covers:
 *  - fmtLocal: wall-clock → iCal compact datetime (always 15 chars)
 *  - escText: RFC 5545 §3.3.11 TEXT escaping
 *  - generateIcs: structural correctness of the output
 *
 * Run:
 *   node --experimental-strip-types --test lib/booking-enquiries/ics.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateIcs } from './ics.ts'

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseIcs(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of content.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    map.set(line.slice(0, colon), line.slice(colon + 1))
  }
  return map
}

const BASE_PARAMS = {
  uid: 'test-uid-123',
  summary: 'Glass Cabin — John Doe',
  description: 'Guest: John Doe\nEmail: john@example.com',
  startDatetime: '2026-05-10T14:00',
  endDatetime: '2026-05-12T11:00',
  timezone: 'Asia/Kolkata',
  organizerEmail: 'admin@resort.com'
}

// ─── fmtLocal (tested via DTSTART output) ───────────────────────────────────

describe('fmtLocal — wall-clock to iCal compact datetime', () => {
  test('HH:MM input produces exactly 15 chars', () => {
    const ics = generateIcs({
      ...BASE_PARAMS,
      startDatetime: '2026-05-10T14:00'
    })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')
    assert.ok(dtstart, 'DTSTART;TZID line must exist')
    assert.equal(
      dtstart!.length,
      15,
      `Expected 15 chars, got ${dtstart!.length}: "${dtstart}"`
    )
    assert.equal(dtstart, '20260510T140000')
  })

  test('HH:MM:SS input produces exactly 15 chars', () => {
    const ics = generateIcs({
      ...BASE_PARAMS,
      startDatetime: '2026-05-10T14:00:00'
    })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')
    assert.equal(dtstart!.length, 15)
    assert.equal(dtstart, '20260510T140000')
  })

  test('date-only input (no T) appends T000000', () => {
    const ics = generateIcs({ ...BASE_PARAMS, startDatetime: '2026-05-10' })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')
    assert.equal(dtstart, '20260510T000000')
  })

  test('end datetime with HH:MM also 15 chars', () => {
    const ics = generateIcs({ ...BASE_PARAMS, endDatetime: '2026-05-12T11:00' })
    const map = parseIcs(ics)
    const dtend = map.get('DTEND;TZID=Asia/Kolkata')
    assert.equal(dtend!.length, 15)
    assert.equal(dtend, '20260512T110000')
  })

  test('midnight time produces T000000', () => {
    const ics = generateIcs({
      ...BASE_PARAMS,
      startDatetime: '2026-06-01T00:00'
    })
    const map = parseIcs(ics)
    assert.equal(map.get('DTSTART;TZID=Asia/Kolkata'), '20260601T000000')
  })

  test('no dashes or colons remain in compact datetime', () => {
    const ics = generateIcs({
      ...BASE_PARAMS,
      startDatetime: '2026-12-31T23:59'
    })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')!
    assert.ok(!dtstart.includes('-'), 'No dashes in compact datetime')
    assert.ok(!dtstart.includes(':'), 'No colons in compact datetime')
  })
})

// ─── RFC 5545 TEXT escaping ──────────────────────────────────────────────────

describe('escText — RFC 5545 §3.3.11 TEXT escaping', () => {
  test('backslash is escaped', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Cabin\\Resort' })
    assert.ok(
      ics.includes('SUMMARY:Cabin\\\\Resort'),
      'backslash must be doubled'
    )
  })

  test('semicolon is escaped', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Cabin;Lake' })
    assert.ok(ics.includes('SUMMARY:Cabin\\;Lake'))
  })

  test('comma is escaped', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Cabin,View' })
    assert.ok(ics.includes('SUMMARY:Cabin\\,View'))
  })

  test('newline in description is escaped as \\n', () => {
    const ics = generateIcs({ ...BASE_PARAMS, description: 'Line1\nLine2' })
    assert.ok(ics.includes('DESCRIPTION:Line1\\nLine2'))
  })

  test('multiple special chars in one string', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'A;B,C\\D' })
    assert.ok(ics.includes('SUMMARY:A\\;B\\,C\\\\D'))
  })

  test('plain text is unchanged', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Glass Cabin Booking' })
    assert.ok(ics.includes('SUMMARY:Glass Cabin Booking'))
  })
})

// ─── generateIcs — structural correctness ───────────────────────────────────

describe('generateIcs — structure', () => {
  test('contains required iCal wrappers', () => {
    const ics = generateIcs(BASE_PARAMS)
    assert.ok(ics.startsWith('BEGIN:VCALENDAR'))
    assert.ok(ics.includes('BEGIN:VEVENT'))
    assert.ok(ics.includes('END:VEVENT'))
    assert.ok(ics.endsWith('END:VCALENDAR'))
  })

  test('lines are joined with CRLF', () => {
    const ics = generateIcs(BASE_PARAMS)
    assert.ok(ics.includes('\r\n'), 'Must use CRLF line endings per RFC 5545')
  })

  test('DTSTAMP is UTC (ends with Z)', () => {
    const ics = generateIcs(BASE_PARAMS)
    const map = parseIcs(ics)
    const dtstamp = map.get('DTSTAMP')
    assert.ok(
      dtstamp?.endsWith('Z'),
      `DTSTAMP must end with Z, got: ${dtstamp}`
    )
    assert.equal(dtstamp!.length, 16, 'DTSTAMP should be 15 chars + Z')
  })

  test('UID contains the uid param', () => {
    const ics = generateIcs(BASE_PARAMS)
    assert.ok(ics.includes('UID:test-uid-123@vibeagent'))
  })

  test('TZID matches the timezone param', () => {
    const ics = generateIcs({ ...BASE_PARAMS, timezone: 'America/New_York' })
    assert.ok(ics.includes('DTSTART;TZID=America/New_York:'))
    assert.ok(ics.includes('DTEND;TZID=America/New_York:'))
  })

  test('METHOD is REQUEST', () => {
    const ics = generateIcs(BASE_PARAMS)
    const map = parseIcs(ics)
    assert.equal(map.get('METHOD'), 'REQUEST')
  })

  test('ORGANIZER contains the email', () => {
    const ics = generateIcs(BASE_PARAMS)
    assert.ok(ics.includes('ORGANIZER:mailto:admin@resort.com'))
  })
})
