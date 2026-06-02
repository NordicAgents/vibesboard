/**
 * Tests for the ICS generator used by simple booking.
 *
 * Covers:
 *  - fmtLocal: wall-clock → iCal compact datetime (always 15 chars)
 *  - escText: RFC 5545 §3.3.11 TEXT escaping
 *  - generateIcs: structural correctness of the output
 */
import { describe, it, expect } from 'vitest'
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
  organizerEmail: 'admin@resort.com',
}

// ─── fmtLocal (tested via DTSTART output) ───────────────────────────────────

describe('fmtLocal — wall-clock to iCal compact datetime', () => {
  it('HH:MM input produces exactly 15 chars', () => {
    const ics = generateIcs({ ...BASE_PARAMS, startDatetime: '2026-05-10T14:00' })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')
    expect(dtstart).toBeTruthy()
    expect(dtstart!.length).toBe(15)
    expect(dtstart).toBe('20260510T140000')
  })

  it('HH:MM:SS input produces exactly 15 chars', () => {
    const ics = generateIcs({ ...BASE_PARAMS, startDatetime: '2026-05-10T14:00:00' })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')
    expect(dtstart!.length).toBe(15)
    expect(dtstart).toBe('20260510T140000')
  })

  it('date-only input (no T) appends T000000', () => {
    const ics = generateIcs({ ...BASE_PARAMS, startDatetime: '2026-05-10' })
    const map = parseIcs(ics)
    expect(map.get('DTSTART;TZID=Asia/Kolkata')).toBe('20260510T000000')
  })

  it('end datetime with HH:MM also 15 chars', () => {
    const ics = generateIcs({ ...BASE_PARAMS, endDatetime: '2026-05-12T11:00' })
    const map = parseIcs(ics)
    const dtend = map.get('DTEND;TZID=Asia/Kolkata')
    expect(dtend!.length).toBe(15)
    expect(dtend).toBe('20260512T110000')
  })

  it('midnight time produces T000000', () => {
    const ics = generateIcs({ ...BASE_PARAMS, startDatetime: '2026-06-01T00:00' })
    const map = parseIcs(ics)
    expect(map.get('DTSTART;TZID=Asia/Kolkata')).toBe('20260601T000000')
  })

  it('no dashes or colons remain in compact datetime', () => {
    const ics = generateIcs({ ...BASE_PARAMS, startDatetime: '2026-12-31T23:59' })
    const map = parseIcs(ics)
    const dtstart = map.get('DTSTART;TZID=Asia/Kolkata')!
    expect(dtstart.includes('-')).toBe(false)
    expect(dtstart.includes(':')).toBe(false)
  })
})

// ─── RFC 5545 TEXT escaping ──────────────────────────────────────────────────

describe('escText — RFC 5545 §3.3.11 TEXT escaping', () => {
  it('backslash is escaped', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Cabin\\Resort' })
    expect(ics).toContain('SUMMARY:Cabin\\\\Resort')
  })

  it('semicolon is escaped', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Cabin;Lake' })
    expect(ics).toContain('SUMMARY:Cabin\\;Lake')
  })

  it('comma is escaped', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Cabin,View' })
    expect(ics).toContain('SUMMARY:Cabin\\,View')
  })

  it('newline in description is escaped as \\n', () => {
    const ics = generateIcs({ ...BASE_PARAMS, description: 'Line1\nLine2' })
    expect(ics).toContain('DESCRIPTION:Line1\\nLine2')
  })

  it('multiple special chars in one string', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'A;B,C\\D' })
    expect(ics).toContain('SUMMARY:A\\;B\\,C\\\\D')
  })

  it('plain text is unchanged', () => {
    const ics = generateIcs({ ...BASE_PARAMS, summary: 'Glass Cabin Booking' })
    expect(ics).toContain('SUMMARY:Glass Cabin Booking')
  })
})

// ─── generateIcs — structural correctness ───────────────────────────────────

describe('generateIcs — structure', () => {
  it('contains required iCal wrappers', () => {
    const ics = generateIcs(BASE_PARAMS)
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })

  it('lines are joined with CRLF', () => {
    const ics = generateIcs(BASE_PARAMS)
    expect(ics).toContain('\r\n')
  })

  it('emits the fixed VERSION, PRODID and CALSCALE headers', () => {
    const ics = generateIcs(BASE_PARAMS)
    const map = parseIcs(ics)
    expect(map.get('VERSION')).toBe('2.0')
    expect(map.get('PRODID')).toBe('-//VibeAgent//SimpleBooking//EN')
    expect(map.get('CALSCALE')).toBe('GREGORIAN')
  })

  it('DTSTAMP is UTC (ends with Z)', () => {
    const ics = generateIcs(BASE_PARAMS)
    const map = parseIcs(ics)
    const dtstamp = map.get('DTSTAMP')
    expect(dtstamp?.endsWith('Z')).toBe(true)
    expect(dtstamp!.length).toBe(16)
  })

  it('UID contains the uid param suffixed with @vibeagent', () => {
    const ics = generateIcs(BASE_PARAMS)
    expect(ics).toContain('UID:test-uid-123@vibeagent')
  })

  it('TZID matches the timezone param', () => {
    const ics = generateIcs({ ...BASE_PARAMS, timezone: 'America/New_York' })
    expect(ics).toContain('DTSTART;TZID=America/New_York:')
    expect(ics).toContain('DTEND;TZID=America/New_York:')
  })

  it('METHOD is REQUEST', () => {
    const ics = generateIcs(BASE_PARAMS)
    const map = parseIcs(ics)
    expect(map.get('METHOD')).toBe('REQUEST')
  })

  it('ORGANIZER contains the email', () => {
    const ics = generateIcs(BASE_PARAMS)
    expect(ics).toContain('ORGANIZER:mailto:admin@resort.com')
  })

  it('does not UTC-convert the wall-clock time (no Z on DTSTART/DTEND)', () => {
    const ics = generateIcs(BASE_PARAMS)
    const map = parseIcs(ics)
    expect(map.get('DTSTART;TZID=Asia/Kolkata')!.endsWith('Z')).toBe(false)
    expect(map.get('DTEND;TZID=Asia/Kolkata')!.endsWith('Z')).toBe(false)
  })
})
