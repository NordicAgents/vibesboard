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
  startDatetime: string  // wall-clock, e.g. "2026-05-10T14:00" — no tz suffix
  endDatetime: string
  timezone: string       // IANA tz, e.g. "Asia/Kolkata" — used as TZID, not for conversion
  organizerEmail: string
}): string {
  // "2026-05-10T14:00" → "20260510T140000"
  const fmtLocal = (s: string) => {
    const base = s.includes('T') ? s : `${s}T00:00:00`
    return base.replace(/-/g, '').replace(':', '').replace(':', '').slice(0, 15)
  }

  // DTSTAMP must be UTC
  const dtstamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VibeAgent//SimpleBooking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}@vibeagent`,
    `SUMMARY:${params.summary}`,
    `DESCRIPTION:${params.description.replace(/\n/g, '\\n')}`,
    `DTSTART;TZID=${params.timezone}:${fmtLocal(params.startDatetime)}`,
    `DTEND;TZID=${params.timezone}:${fmtLocal(params.endDatetime)}`,
    `ORGANIZER:mailto:${params.organizerEmail}`,
    `DTSTAMP:${dtstamp}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ]

  return lines.join('\r\n')
}
