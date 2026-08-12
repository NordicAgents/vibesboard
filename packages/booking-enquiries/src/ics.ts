/**
 * Generates a valid iCalendar (.ics) string for a booking enquiry.
 *
 * Timezone handling: uses DTSTART;TZID= format so the wall-clock time is
 * preserved exactly as given — no UTC conversion. This avoids the JS pitfall
 * where new Date("2026-05-10T14:00:00") is parsed as server local time rather
 * than the resource's timezone.
 */
export function generateIcs(params: {
  uid: string
  summary: string
  description: string
  startDatetime: string // wall-clock, e.g. "2026-05-10T14:00" — no tz suffix
  endDatetime: string
  timezone: string // IANA tz, e.g. "Asia/Kolkata" — used as TZID, not for conversion
  organizerEmail: string
}): string {
  // "2026-05-10T14:00" → "20260510T140000"
  // Pad HH:MM to HH:MM:SS before stripping so we always get 15 chars.
  const fmtLocal = (s: string) => {
    const base = s.includes('T') ? s : `${s}T00:00:00`
    const padded = /T\d{2}:\d{2}$/.test(base) ? `${base}:00` : base
    return padded.replace(/-/g, '').replace(/:/g, '').slice(0, 15)
  }

  // RFC 5545 §3.3.11: escape backslash, semicolon, comma in TEXT properties.
  const escText = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')

  // DTSTAMP must be UTC
  const dtstamp =
    new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vibesboard//SimpleBooking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}@vibesboard`,
    `SUMMARY:${escText(params.summary)}`,
    `DESCRIPTION:${escText(params.description)}`,
    `DTSTART;TZID=${params.timezone}:${fmtLocal(params.startDatetime)}`,
    `DTEND;TZID=${params.timezone}:${fmtLocal(params.endDatetime)}`,
    `ORGANIZER:mailto:${params.organizerEmail}`,
    `DTSTAMP:${dtstamp}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ]

  return lines.join('\r\n')
}
