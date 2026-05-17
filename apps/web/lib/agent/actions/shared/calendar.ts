// lib/agent/actions/shared/calendar.ts
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry'

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

// ─── Types ──────────────────────────────────────────────────────────

export interface BusySlot {
  start: number  // ms timestamp
  end: number    // ms timestamp
}

// ─── Date parsing ───────────────────────────────────────────────────

/**
 * Parse a wall-clock datetime string as UTC.
 * Handles: YYYY-MM-DD, YYYY-MM-DDTHH:MM, full ISO with Z or offset.
 */
export function parseWallClock(datetime: string): Date {
  const iso = datetime.includes('T') ? datetime : `${datetime}T00:00:00`
  return new Date(iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

// ─── Conflict detection ─────────────────────────────────────────────

export function hasConflict(busySlots: BusySlot[], startMs: number, endMs: number): boolean {
  return busySlots.some(b => startMs < b.end && endMs > b.start)
}

// ─── FreeBusy query ─────────────────────────────────────────────────

/**
 * Query Google Calendar freeBusy API for busy slots in a time range.
 * Used by both Appointments and Booking modules.
 */
export async function checkFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusySlot[]> {
  const res = await fetchWithRetry(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }]
    }),
    timeoutMs: 10_000,
    maxAttempts: 3,
    baseDelayMs: 500
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Calendar freeBusy API error ${res.status}: ${body}`)
  }
  const data = await res.json()
  const raw: Array<{ start: string; end: string }> = data?.calendars?.[calendarId]?.busy ?? []
  return raw
    .map(s => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
    .sort((a, b) => a.start - b.start)
}

// ─── Display formatting ─────────────────────────────────────────────

export function formatSlotDisplay(isoDate: string, timezone: string): string {
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

export function formatDateRange(startMs: number, durationMs: number, timezone: string): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  return `${fmt(startMs)} → ${fmt(startMs + durationMs)}`
}
